// Advisory password strength meter for the Add user wizard. Pure. The company's password policy is enforced by the server (validatePassword);
// this only gives the live "Weak / Fair / Strong" feedback Microsoft-style forms show.
export function passwordStrength(pw) {
  const s = String(pw || "");
  if (!s) return { level: 0, label: "", ok: false };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(s)).length;
  let score = 0;
  if (s.length >= 8) score++;
  if (s.length >= 12) score++;
  if (classes >= 3) score++;
  if (classes === 4 && s.length >= 10) score++;
  if (/(.)\1{3,}/.test(s) || /^(password|12345678|qwerty)/i.test(s)) score = Math.max(0, score - 2);
  if (s.length < 8) return { level: 1, label: "Weak", ok: false };
  const level = score >= 4 ? 3 : score >= 2 ? 2 : 1;
  return { level, label: ["", "Weak", "Fair", "Strong"][level], ok: level >= 2 };
}
