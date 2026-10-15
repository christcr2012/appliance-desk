import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  addLocationPerson, createTenantRepairLink, effectiveLocationPermission,
  eraseExpiredTenantPII, getJobLocationPrivacy, importLocationCsv, locationWorkspace,
  moveOutLocationPerson, saveAccountLocationPermission, saveLocationDetails,
  setLocationRetention, submitTenantRepair, tenantRepairOptions,
} from "@/domains/customers/location-contacts";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";
describe.skipIf(!enabled)("W-23 actual Postgres ownership and tenant life cycle", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const prefix = "w23-" + tag;
  const userIds = ["owner-", "customerA-", "customerB-", "staff-"].map(x => prefix + x);
  const customerIds = ["a", "b"].map(x => prefix + "-customer-" + x);
  const addresses: string[] = [];
  const createdContacts: string[] = [];
  const jobIds: string[] = [];
  const requests: string[] = [];
  const assets: string[] = [];
  let typeId: string;
  let agreementId: string;
  let lineId: string;
  let oldRetention = 12;
  const owner = { role: "OWNER" as const, userId: userIds[0] };
  const client = { role: "CUSTOMER" as const, userId: userIds[1], customerId: customerIds[0] };
  const foreign = { role: "CUSTOMER" as const, userId: userIds[2], customerId: customerIds[1] };
  const permission = { deliveryPickup: true, maintenance: true, swaps: true,
    appointmentConfirmer: "TENANT" as const, copyClient: true };

  beforeAll(async () => {
    oldRetention = (await prisma.businessSettings.findUnique({ where: { id: "singleton" },
      select: { tenantContactRetentionMonths: true } }))?.tenantContactRetentionMonths ?? 12;
    await prisma.user.createMany({ data: [
      { id: userIds[0], email: prefix + "-o@example.test", role: "OWNER" },
      { id: userIds[1], email: prefix + "-a@example.test", role: "CUSTOMER" },
      { id: userIds[2], email: prefix + "-b@example.test", role: "CUSTOMER" },
      { id: userIds[3], email: prefix + "-s@example.test", role: "STAFF" },
    ] });
    for (const [i,id] of customerIds.entries()) {
      await prisma.customer.create({ data: { id, userId: userIds[i+1], referralCode: "W23"+tag+i } });
      const a = await prisma.serviceAddress.create({ data: {
        customerId: id, line1: String((i+1)*100) + " Test St", city: "Denver", zip: "80201",
      } }); addresses.push(a.id);
    }
    typeId = (await prisma.applianceType.create({ data: { name: "W23"+tag,
      slug: "w23-"+tag } })).id;
    const unit = await prisma.appliance.create({ data: {
      assetNumber: "W23"+tag, applianceTypeId: typeId, status: "RENTED",
    } }); assets.push(unit.id);
    const agreement = await prisma.rentalAgreement.create({ data: {
      customerId: customerIds[0], serviceAddressId: addresses[0], status: "ACTIVE",
    } }); agreementId = agreement.id;
    const line = await prisma.rentalLine.create({ data: {
      agreementId, label: "washer", monthlyPriceCents: 5000, listPriceCents: 5000,
    } }); lineId = line.id;
    await prisma.applianceAssignment.create({ data: { rentalLineId: lineId, applianceId: unit.id } });
  });
  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" },
      data: { tenantContactRetentionMonths: oldRetention } });
    await prisma.customerNotice.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.maintenanceRequest.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.staffTask.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [
      { userId: { in: userIds } },
      { entityId: { in: [...addresses,...customerIds,...requests] } },
      { action: "location.retention.erasure" },
    ] } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.locationContact.deleteMany({ where: { serviceAddressId: { in: addresses } } });
    await prisma.applianceAssignment.deleteMany({ where: { rentalLineId: lineId } });
    await prisma.rentalLine.deleteMany({ where: { id: lineId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.appliance.deleteMany({ where: { id: { in: assets } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.serviceAddress.deleteMany({ where: { id: { in: addresses } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("denies foreign client URL, tampered create and site update; client may manage only own site", async () => {
    await expect(locationWorkspace(client, customerIds[1])).rejects.toThrow(/not on your account/i);
    await expect(addLocationPerson(client, customerIds[0], addresses[1], {
      name: "Intruder", role: "TENANT", phone: "", email: "",
      preferredLanguage: "en", startedAt: "",
    })).rejects.toThrow(/not on your account/i);
    await expect(saveLocationDetails(foreign, customerIds[0], addresses[0], {
      unitLabel: "Stolen", accessNotes: "exfiltrate", override: permission,
    })).rejects.toThrow(/not on your account/i);
    await saveAccountLocationPermission(client, customerIds[0], permission);
    await saveLocationDetails(client, customerIds[0], addresses[0], {
      unitLabel: "4B", accessNotes: "dog; gate code 4321", override: null,
    });
    const read = await locationWorkspace(client, customerIds[0]);
    expect(read.serviceAddresses[0]?.unitLabel).toBe("4B");
    expect(read.serviceAddresses[0]?.accessNotes).toBe("dog; gate code 4321");
    expect(effectiveLocationPermission(read.locationContactPolicy, null).maintenance).toBe(true);
  });

  it("shows private visit details only to explicitly assigned staff, never to unassigned or foreign staff", async () => {
    const job = await prisma.job.create({ data: {
      type: "MAINTENANCE_VISIT", customerId: customerIds[0], serviceAddressId: addresses[0],
      assignedToUserId: userIds[3], status: "SCHEDULED",
    } }); jobIds.push(job.id);
    expect((await getJobLocationPrivacy({ userId: userIds[3], role: "STAFF" },job.id))?.accessNotes)
      .toContain("4321");
    expect(await getJobLocationPrivacy({ userId: userIds[1], role: "STAFF" },job.id)).toBeNull();
    await prisma.job.update({ where: { id:job.id },data:{assignedToUserId:null} });
    expect(await getJobLocationPrivacy({ userId:userIds[3], role:"STAFF" },job.id)).toBeNull();
    expect(await getJobLocationPrivacy({ userId:userIds[1], role:"CUSTOMER" },job.id)).toBeNull();
  });

  it("tenant maintenance link scopes the appliance, requires client grant, consumes exactly once and notifies only the client", async () => {
    const person = await addLocationPerson(client, customerIds[0], addresses[0], {
      name:"Tenant",role:"TENANT",phone:"",email:"",preferredLanguage:"en",startedAt:"",
    }); createdContacts.push(person);
    const path = await createTenantRepairLink(client,customerIds[0],addresses[0],person);
    const token = path.split("/").at(-1)!;
    expect((await tenantRepairOptions(token))?.appliances.map(x=>x.id)).toContain(assets[0]);
    await expect(submitTenantRepair(token,{applianceId:"foreign",problem:"The washer does not spin"}))
      .rejects.toThrow(/active rental/i);
    expect(await tenantRepairOptions(token)).not.toBeNull(); // unsuccessful attempt did not consume
    const request = await submitTenantRepair(token,{applianceId:assets[0],problem:"The washer does not spin"});
    requests.push(request);
    await expect(submitTenantRepair(token,{applianceId:assets[0],problem:"The washer does not spin"}))
      .rejects.toThrow(/no longer active/i);
    expect(await tenantRepairOptions(token)).toBeNull();
    expect(await prisma.maintenanceRequest.findUniqueOrThrow({where:{id:request}}))
      .toMatchObject({customerId:customerIds[0],serviceAddressId:addresses[0],applianceId:assets[0]});
    expect(await prisma.customerNotice.count({where:{customerId:customerIds[0],kind:"TENANT_REPAIR"}})).toBe(1);
    expect(await prisma.customerNotice.count({where:{customerId:customerIds[1],kind:"TENANT_REPAIR"}})).toBe(0);
  });

  it("move-out leaves rental billing unchanged, queues inspection once, and erases personal details after 12 months", async () => {
    const person = await addLocationPerson(owner,customerIds[0],addresses[0],{
      name:"Former",role:"TENANT",phone:"3035551000",email:"former@example.test",
      preferredLanguage:"es",startedAt:"",
    }); createdContacts.push(person);
    const originalLine = await prisma.rentalLine.findUniqueOrThrow({ where: { id:lineId } });
    await moveOutLocationPerson(client,customerIds[0],addresses[0],person,true);
    await expect(moveOutLocationPerson(client,customerIds[0],addresses[0],person,true)).rejects.toThrow();
    expect(await prisma.staffTask.count({where:{sourceKey:"tenant-turnover:"+person}})).toBe(1);
    expect((await prisma.rentalLine.findUniqueOrThrow({where:{id:lineId}})).monthlyPriceCents)
      .toBe(originalLine.monthlyPriceCents);
    await prisma.locationContact.update({where:{id:person},data:{endedAt:new Date("2024-01-01T00:00:00Z")}});
    const erased = await eraseExpiredTenantPII(new Date("2026-10-15T00:00:00Z"));
    expect(erased).toBeGreaterThanOrEqual(1);
    expect(await prisma.locationContact.findUniqueOrThrow({where:{id:person}}))
      .toMatchObject({name:null,phone:null,email:null,preferredLanguage:"en"});
    await setLocationRetention(owner, 24);
    expect((await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"}}))
      .tenantContactRetentionMonths).toBe(24);
  });

  it("validates complete CSV before writing, rejects existing property, imports atomically", async () => {
    const header="street,unit,city,state,zip,unitLabel,tenantName,tenantPhone,tenantEmail,language";
    const csv=header+"\n600 Test Rd,,Denver,CO,80201,Unit 7,Jan,,jan@example.test,en\n";
    expect(await importLocationCsv(owner,customerIds[0],csv)).toBe(1);
    const address=await prisma.serviceAddress.findFirstOrThrow({
      where:{customerId:customerIds[0],line1:"600 Test Rd"},
    });
    addresses.push(address.id);
    expect(await prisma.locationContact.count({where:{serviceAddressId:address.id}})).toBe(1);
    await expect(importLocationCsv(owner,customerIds[0],csv)).rejects.toThrow(/already exists/i);
    const bad=header+"\n700 Test Rd,,Denver,CO,80201,,,,,\n=1+1,,Denver,CO,80201,,,,,\n";
    await expect(importLocationCsv(owner,customerIds[0],bad)).rejects.toThrow(/formula/i);
    expect(await prisma.serviceAddress.count({where:{customerId:customerIds[0],line1:"700 Test Rd"}})).toBe(0);
    await expect(importLocationCsv(client,customerIds[0],csv)).rejects.toThrow(/owner/i);
  });
});
