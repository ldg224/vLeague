// Which table a game belongs to. The one rule every table, stat and "does this count" check shares (no imports, so tests and any page can load it).
//
//   tableOf(fixture)      'preseason' | 'season' | null (a Test match, a showcase round and the finals are in no table)
//   counts(fixture, scope)   does it count in that table? scope is 'preseason' or 'season' (the default)
//
// A fixture carries `preseason: true` when its round's Type is Preseason (js/dashboard-data.js), and `exhibition: true` when its round does not
// count for the table (every preseason round does not). Win chance, form and head-to-head still leave exhibitions out; only the preseason table
// and preseason stats look at the preseason games.
export const tableOf = f => (f.test ? null : f.preseason ? 'preseason' : f.exhibition || f.stage ? null : 'season');
export const counts = (f, scope = 'season') => tableOf(f) === scope;
// Stats take the finals too (a final's goals and cards are the season's), but never the preseason games, a Test match or a showcase round.
export const inStats = (f, scope = 'season') => !f.test && (scope === 'preseason' ? Boolean(f.preseason) : !f.exhibition);
