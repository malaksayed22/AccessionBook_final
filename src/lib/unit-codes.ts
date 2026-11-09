export function getUnitBarcodeValue(unitId: number, unitName: string) {
  return unitName;
}

export function getUnitProfilePath(unitId: number) {
  return `/inventory/units/${unitId}`;
}

export function getUnitScanPath(unitId: number) {
  return `/scan/${unitId}`;
}

export function getUnitProfileUrl(baseUrl: string, unitId: number) {
  return `${baseUrl.replace(/\/$/, "")}${getUnitProfilePath(unitId)}`;
}
