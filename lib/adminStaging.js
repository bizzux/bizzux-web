// The rules behind the Admin Center's staged edits (role, business profile, account expiry), kept free of React so they can be tested. The user details
// drawer and the Users table both call these; nothing here saves anything.

export const ADMIN_PROFILES = ["Global Admin", "Admin"]; // moving someone to or from these needs the same right as making an Admin

// A staged edit is { [field]: value }, holding only fields that differ from the saved value. Picking the saved value again un-stages it.
export function stageValue(stage, field, value, saved) {
  const next = { ...stage };
  if (value === saved || value === undefined || value === null) delete next[field]; else next[field] = value;
  return next;
}
// What the form shows for a field: the staged value, else the saved one.
export const effective = (stage, field, saved) => (field in stage ? stage[field] : saved);
// "Save changes" is enabled only when something staged really differs from what is saved right now.
export const hasChanges = (stage, saved) => Object.keys(stage).some((k) => stage[k] !== saved[k]);
// "Cancel" discards everything staged.
export const discard = () => ({});

// True when the change makes someone an Admin or takes Admin away, which must be confirmed by name before it is saved.
export function isAdminLevelChange({ curRole, nextRole, curProfile = "", nextProfile = curProfile }) {
  const roleChanged = nextRole !== curRole;
  const profChanged = nextProfile !== curProfile;
  const toAdmin = (roleChanged && nextRole === "ADMIN") || (profChanged && ADMIN_PROFILES.includes(nextProfile));
  const fromAdmin = (roleChanged && curRole === "ADMIN") || (profChanged && ADMIN_PROFILES.includes(curProfile));
  return { toAdmin, fromAdmin, any: toAdmin || fromAdmin };
}

// Account expiry: the person can sign in until the end of the chosen day, so only a date BEFORE today (local calendar day) locks them out right away
// and needs confirming. "" (no expiry) and today or later are fine. `now` is injectable for tests.
export function localDay(now = new Date()) {
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}
export const isPastExpiry = (iso, now = new Date()) => !!iso && iso < localDay(now);

// App access (the Apps & licences tab). `saved` is the drawer's list of apps [{ appId, access, appRole, source, reason }]; `staged` holds only the apps the
// administrator has touched, as { [appId]: { granted, admin } }. Nothing here saves anything.
export const savedApp = (a) => ({ granted: !!a.access, admin: !!a.access && a.appRole === "ADMIN" });
// Ticking an app's Admin box also gives access; clearing access also clears Admin. A value equal to the saved one un-stages the app.
export function stageApp(staged, saved, appId, patch) {
  const base = savedApp(saved.find((a) => a.appId === appId) || {});
  const cur = staged[appId] || base;
  let next = { ...cur, ...patch };
  if (patch.admin === true) next.granted = true;
  if (patch.granted === false) next.admin = false;
  const out = { ...staged };
  if (next.granted === base.granted && next.admin === base.admin) delete out[appId]; else out[appId] = next;
  return out;
}
// The apps whose staged value really differs from what is saved: [{ appId, from, to }].
export function appChanges(saved, staged) {
  return Object.keys(staged).map((appId) => {
    const from = savedApp(saved.find((a) => a.appId === appId) || {});
    return { appId, from, to: staged[appId] };
  }).filter((c) => c.from.granted !== c.to.granted || c.from.admin !== c.to.admin);
}
// Making someone an app Admin, or taking that away, is confirmed by name first (only an Owner may do it).
export const appAdminChanged = (changes) => changes.some((c) => c.from.admin !== c.to.admin);
