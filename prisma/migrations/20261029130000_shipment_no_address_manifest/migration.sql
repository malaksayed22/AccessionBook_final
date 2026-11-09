-- A movement no longer records an address or a manifest number.
ALTER TABLE "Shipment" DROP COLUMN "address";
ALTER TABLE "Shipment" DROP COLUMN "manifestNumber";
