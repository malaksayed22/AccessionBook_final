-- A shipment line says whether it ships all of its unit or a part of it.
ALTER TABLE "ShipmentItem" ADD COLUMN "isPart" BOOLEAN NOT NULL DEFAULT false;
