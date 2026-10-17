-- W-17: a returned appliance that passes inspection is cleaned before it can be rented again. Additive enum value.
ALTER TYPE "ApplianceStatus" ADD VALUE IF NOT EXISTS 'CLEANING';
