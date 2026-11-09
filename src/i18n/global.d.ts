import type common from "../../messages/en/common.json";
import type ui from "../../messages/en/ui.json";
import type shell from "../../messages/en/shell.json";
import type auth from "../../messages/en/auth.json";
import type errors from "../../messages/en/errors.json";
import type profile from "../../messages/en/profile.json";
import type domain from "../../messages/en/domain.json";
import type dashboard from "../../messages/en/dashboard.json";
import type overview from "../../messages/en/overview.json";
import type units from "../../messages/en/units.json";
import type experiments from "../../messages/en/experiments.json";
import type materials from "../../messages/en/materials.json";
import type qa from "../../messages/en/qa.json";
import type recall from "../../messages/en/recall.json";
import type destroyed from "../../messages/en/destroyed.json";
import type locations from "../../messages/en/locations.json";
import type cultivars from "../../messages/en/cultivars.json";
import type organizations from "../../messages/en/organizations.json";
import type members from "../../messages/en/members.json";
import type reports from "../../messages/en/reports.json";
import type recordPdf from "../../messages/en/recordPdf.json";
import type settings from "../../messages/en/settings.json";
import type labels from "../../messages/en/labels.json";
import type tasks from "../../messages/en/tasks.json";
import type sops from "../../messages/en/sops.json";
import type activity from "../../messages/en/activity.json";
import type search from "../../messages/en/search.json";
import type actions from "../../messages/en/actions.json";
import type marketing from "../../messages/en/marketing.json";
import type notifications from "../../messages/en/notifications.json";
import type { AppLocale } from "./routing";

/** Typed message keys: a typo in `t("...")` is a compile error. English is the reference locale. */
declare module "next-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: {
      common: typeof common;
      ui: typeof ui;
      shell: typeof shell;
      auth: typeof auth;
      errors: typeof errors;
      profile: typeof profile;
      domain: typeof domain;
      dashboard: typeof dashboard;
      overview: typeof overview;
      units: typeof units;
      experiments: typeof experiments;
      materials: typeof materials;
      qa: typeof qa;
      recall: typeof recall;
      destroyed: typeof destroyed;
      locations: typeof locations;
      cultivars: typeof cultivars;
      organizations: typeof organizations;
      members: typeof members;
      reports: typeof reports;
      recordPdf: typeof recordPdf;
      settings: typeof settings;
      labels: typeof labels;
      tasks: typeof tasks;
      notifications: typeof notifications;
      sops: typeof sops;
      activity: typeof activity;
      search: typeof search;
      actions: typeof actions;
      marketing: typeof marketing;
    };
  }
}
