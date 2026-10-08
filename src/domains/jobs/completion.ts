import type { JobApplianceResult, JobApplianceRole, JobOutcome, JobType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor, type TeamRole } from "@/lib/team-actor";
import { assertJobScopeInTx } from "./scope";
import { dropSubstituteInTx, takeSubstituteIntoLineInTx } from "./substitution";
import { businessDateKey, businessDayBounds } from "@/lib/business-date";
import { lockCustomerLedger } from "@/domains/billing/ledger";
import { lockRentalAgreementInTx, runCloseAgreementContinuation } from "@/domains/agreements";
import { closeIfFullyReturnedInTx, type ReturnCloseOutcome } from "@/domains/agreements/returns";
import { runEarlyReturnContinuation } from "@/domains/agreements/early-return";
import { startRecurringBillingForAgreement } from "@/domains/billing/checkout";
import { pushLateDeliveryCreditForHandoff } from "@/domains/billing/handoff-adapters";
import { PROVIDER_OPERATION_LEASE_MS } from "@/domains/billing/provider-ops";
import {
  jobServiceDate,
  recordItemsNotDelivered,
  recordLateDeliveries,
  recordLateReturnOnRemoval,
  type PickupBillingOutcome,
} from "@/domains/billing/pickup-billing-events";
import { closeCustodyEpisodeInTx, getOpenCustody, openCustodyEpisodeInTx } from "@/domains/inventory/custody";
import { createTaskInTx } from "@/domains/tasks";
import { lockMaintenanceRequestInTx, requestAfterVisitEndedInTx } from "@/domains/maintenance/visit-sync";
import { JobVersionError } from "./scheduling";¶»§q«^