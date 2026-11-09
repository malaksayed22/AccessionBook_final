export const TEST_PANELS = [
  { id: "POTENCY", label: "Potency (cannabinoids)" },
  { id: "TERPENES", label: "Terpenes" },
  { id: "PESTICIDES", label: "Pesticides" },
  { id: "HEAVY_METALS", label: "Heavy metals" },
  { id: "MICROBIALS", label: "Microbials" },
  { id: "MYCOTOXINS", label: "Mycotoxins" },
  { id: "MOISTURE", label: "Moisture" },
  { id: "FOREIGN", label: "Foreign matter" },
  { id: "OTHER", label: "Other / in-house" },
] as const;

export const INCIDENT_SEVERITIES = [
  { id: "CRITICAL", label: "Critical" },
  { id: "MAJOR", label: "Major" },
  { id: "MINOR", label: "Minor" },
] as const;

export const INCIDENT_STATUSES = [
  { id: "OPEN", label: "Open" },
  { id: "INVESTIGATING", label: "Investigating" },
  { id: "CLOSED", label: "Closed" },
] as const;
