// "See your gap": compare a student's proven skills with what a role asks for,
// and suggest the challenges that close the gap fastest.
import { all, one, type ChallengeRow } from './db.js';
import { DIFFICULTY_RANK, TESTS } from './tests.js';
import { parseJson } from './util.js';
import { challengeView, verifiedSkills } from './views.js';

interface RoleRow {
  id: string;
  title: string;
  org: string;
  author_id: string;
  skills: string;
  description: string;
}

export function computeGap(userId: string, roleId: string) {
  const role = one<RoleRow>('SELECT * FROM roles WHERE id = ?', roleId);
  if (!role) return null;

  const required = parseJson<string[]>(role.skills, []);
  const proven = new Set(verifiedSkills(userId));
  const have = required.filter((s) => proven.has(s));
  const missing = required.filter((s) => !proven.has(s));

  const suggestions = all<ChallengeRow>('SELECT * FROM challenges')
    .map((c) => {
      const test = TESTS.get(c.test_id);
      const covers = (test?.skills ?? []).filter((s) => missing.includes(s));
      let score = covers.length * 10;
      if (c.role_id === role.id) score += 5;
      if (c.author_id === role.author_id) score += 3;
      score -= DIFFICULTY_RANK[test?.difficulty ?? 'beginner'];
      return { challenge: c, covers, score };
    })
    .filter((s) => s.covers.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => ({ covers: s.covers, challenge: challengeView(s.challenge, userId) }));

  return {
    role: { id: role.id, title: role.title, org: role.org, description: role.description, skills: required },
    have,
    missing,
    coverage: required.length ? Math.round((have.length / required.length) * 100) : 100,
    suggestions,
  };
}
