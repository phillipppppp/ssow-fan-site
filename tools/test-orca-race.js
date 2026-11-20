/* ============================================================
   Orca Race fairness check.

       node tools/test-orca-race.js            # run the checks
       node tools/test-orca-race.js CODE       # print one race's result + digest

   Proves the things the page promises:
   1. same race code + same racers -> exactly the same race (every
      position of every orca at every step) and the same winner;
   2. shuffling the lanes changes nothing;
   3. the race length only rescales time (same order);
   4. a different code, or a changed racer list, gives a different
      race;
   5. over many codes every racer wins about equally often.
   The digest printed with a code can be compared across machines
   and browsers: it covers the full race, not just the winner.
   ============================================================ */

const assert = require('assert');
const crypto = require('crypto');
const Sim = require('../orca-race-sim.js');

const RACERS = [
    { name: 'deez', orcaId: 12 }, { name: 'Moby', orcaId: 404 }, { name: 'Shamu', orcaId: null },
    { name: 'Blub', orcaId: 7 }, { name: 'Captain Fin', orcaId: 1999 }, { name: 'Orca #55', orcaId: 55 },
    { name: 'Tidepod', orcaId: null }, { name: 'Krill Bill', orcaId: 321 }
];

function digest(race) {
    const h = crypto.createHash('sha256');
    h.update(race.code + '|' + race.fingerprint + '|' + race.order.join(','));
    race.racers.forEach(function (r) {
        h.update(r.name + '|' + r.finishSteps + '|' + r.bursts.join(','));
        h.update(Buffer.from(r.path.buffer));
    });
    return h.digest('hex').slice(0, 16);
}

function names(race) { return race.order.map(function (l) { return race.racers[l].name; }); }

if (process.argv[2]) {
    const race = Sim.run({ code: process.argv[2], racers: RACERS });
    console.log('code', race.code, 'racers #' + race.fingerprint, 'digest', digest(race));
    names(race).forEach(function (n, i) { console.log((i + 1) + '. ' + n); });
    process.exit(0);
}

/* 1. same code + same list, twice */
const a = Sim.run({ code: 'K7QX2M', racers: RACERS });
const b = Sim.run({ code: 'K7QX2M', racers: RACERS.map(function (r) { return Object.assign({}, r); }) });
assert.strictEqual(digest(a), digest(b), 'same code + racers must give the identical race');
assert.deepStrictEqual(names(a), names(b));
console.log('✓ same code + same racers -> identical race. Winner: ' + names(a)[0] + ' · order: ' + names(a).join(', '));
console.log('  run 1 digest ' + digest(a) + ' · run 2 digest ' + digest(b));

/* the code is case- and space-insensitive */
assert.deepStrictEqual(names(Sim.run({ code: ' k7qx-2m ', racers: RACERS })), names(a));
console.log('✓ "k7qx-2m" replays the same race as "K7QX2M"');

/* 2. shuffled lanes */
const shuffled = RACERS.slice().reverse();
shuffled.push(shuffled.shift());
const c = Sim.run({ code: 'K7QX2M', racers: shuffled });
assert.deepStrictEqual(names(c), names(a), 'lane order must not change the result');
assert.strictEqual(c.fingerprint, a.fingerprint);
c.racers.forEach(function (r) {
    const twin = a.racers.find(function (x) { return x.name === r.name; });
    assert.strictEqual(r.finishSteps, twin.finishSteps);
});
console.log('✓ shuffled lanes -> same order and same finish times');

/* 3. length only rescales time */
const t10 = Sim.timeScale(a, 10), t30 = Sim.timeScale(a, 30);
assert.ok(Math.abs(a.racers[a.order[0]].finishSteps * t10 - 10) < 1e-9);
assert.ok(Math.abs(a.racers[a.order[0]].finishSteps * t30 - 30) < 1e-9);
console.log('✓ 10s / 30s races: winner crosses at exactly 10.000s / 30.000s, same order');

/* 4. different code / different racers */
const d = Sim.run({ code: 'K7QX2N', racers: RACERS });
assert.notStrictEqual(digest(d), digest(a));
const e = Sim.run({ code: 'K7QX2M', racers: RACERS.concat([{ name: 'Latecomer', orcaId: 9 }]) });
assert.notStrictEqual(e.fingerprint, a.fingerprint);
assert.notStrictEqual(digest(e), digest(a));
const f = Sim.run({ code: 'K7QX2M', racers: RACERS.map(function (r, i) { return i === 0 ? { name: 'deez', orcaId: 13 } : r; }) });
assert.notStrictEqual(f.fingerprint, a.fingerprint);
console.log('✓ a different code, an extra racer or a changed orca ID -> a different race (and fingerprint)');

/* 5. every racer equally likely */
const N = 4000;
const wins = {};
for (let i = 0; i < N; i++) {
    const w = names(Sim.run({ code: 'FAIR' + i, racers: RACERS }))[0];
    wins[w] = (wins[w] || 0) + 1;
}
const expected = N / RACERS.length;
Object.keys(wins).forEach(function (k) {
    assert.ok(Math.abs(wins[k] - expected) < expected * 0.2, k + ' won ' + wins[k] + ' of ' + N);
});
console.log('✓ ' + N + ' races: wins per racer ' + JSON.stringify(wins) + ' (expected ~' + expected + ' each)');

/* never Math.random during a race */
const real = Math.random;
Math.random = function () { throw new Error('Math.random used'); };
try { Sim.run({ code: 'NORANDOM', racers: RACERS }); } finally { Math.random = real; }
console.log('✓ the simulator never calls Math.random');

console.log('All fairness checks passed.');
