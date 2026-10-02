// ============================================================
// A local stand-in for Supabase, for testing Whale Road offline.
//
//     npx deno@2 run -A tools/dev-backend.ts
//
// Runs the real edge-function handler against a real Postgres
// (PGlite, in-process) with the real migration applied, and serves
// it on http://localhost:8787. Point game-config.js at that URL to
// play the whole online flow without touching the live project.
//
// It answers only the slice of the supabase-js API the handler
// uses; data lives in memory and is gone when this stops.
// ============================================================

import { PGlite } from 'npm:@electric-sql/pglite@0.3.16';
import { citext } from 'npm:@electric-sql/pglite@0.3.16/contrib/citext';
import { createHandler } from '../supabase/functions/whale-road/handler.ts';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export async function makeLocalDb() {
    const pg = new PGlite({ extensions: { citext } });
    for (const role of ['anon', 'authenticated', 'service_role']) await pg.exec(`create role ${role} nologin`);
    const dir = new URL('../supabase/migrations/', import.meta.url);
    const files = [];
    for await (const f of Deno.readDir(dir)) if (f.name.endsWith('.sql')) files.push(f.name);
    for (const name of files.sort()) await pg.exec(await Deno.readTextFile(new URL(name, dir)));

    const fail = (e: Row) => ({ data: null, error: { message: e.message, code: e.code } });

    class Query {
        op = 'select';
        cols = '*';
        returning: string | null = null;
        filters: [string, unknown][] = [];
        values: Row = {};
        mode: 'many' | 'one' | 'maybe' = 'many';
        orders: string[] = [];
        max: number | null = null;
        constructor(public table: string) {}

        select(cols = '*') {
            if (this.op === 'select') this.cols = cols;
            else this.returning = cols;
            return this;
        }
        insert(values: Row) { this.op = 'insert'; this.values = values; return this; }
        update(values: Row) { this.op = 'update'; this.values = values; return this; }
        eq(col: string, value: unknown) { this.filters.push([col, value]); return this; }
        order(col: string, opts: { ascending?: boolean } = {}) { this.orders.push(col + (opts.ascending === false ? ' desc' : ' asc')); return this; }
        limit(n: number) { this.max = n; return this; }
        single() { this.mode = 'one'; return this.run(); }
        maybeSingle() { this.mode = 'maybe'; return this.run(); }
        then(ok: (v: Row) => unknown, bad?: (e: unknown) => unknown) { return this.run().then(ok, bad); }

        async run() {
            const params: unknown[] = [];
            const p = (v: unknown) => { params.push(v); return '$' + params.length; };
            let sql: string;
            if (this.op === 'select') {
                // the one embed the handler uses: sessions -> wr_players(...)
                const embed = /(\w+)\(([^)]*)\)/.exec(this.cols);
                if (embed) {
                    const plain = this.cols.replace(embed[0], '').split(',').map((c) => c.trim()).filter(Boolean);
                    const inner = embed[2].split(',').map((c) => c.trim());
                    sql = `select ${plain.map((c) => 't.' + c).join(', ')}, ` +
                        `json_build_object(${inner.map((c) => `'${c}', e.${c}`).join(', ')}) as ${embed[1]} ` +
                        `from ${this.table} t join ${embed[1]} e on e.id = t.player_id`;
                    if (this.filters.length) sql += ' where ' + this.filters.map(([c, v]) => `t.${c} = ${p(v)}`).join(' and ');
                } else {
                    sql = `select ${this.cols} from ${this.table}`;
                    if (this.filters.length) sql += ' where ' + this.filters.map(([c, v]) => `${c} = ${p(v)}`).join(' and ');
                }
                if (this.orders.length) sql += ' order by ' + this.orders.join(', ');
                if (this.max !== null) sql += ' limit ' + Number(this.max);
            } else if (this.op === 'insert') {
                const keys = Object.keys(this.values);
                sql = `insert into ${this.table} (${keys.join(', ')}) values (${keys.map((k) => p(this.values[k])).join(', ')})`;
                if (this.returning) sql += ` returning ${this.returning}`;
            } else {
                const keys = Object.keys(this.values);
                sql = `update ${this.table} set ${keys.map((k) => `${k} = ${p(this.values[k])}`).join(', ')}`;
                if (this.filters.length) sql += ' where ' + this.filters.map(([c, v]) => `${c} = ${p(v)}`).join(' and ');
                if (this.returning) sql += ` returning ${this.returning}`;
            }
            try {
                const rows = (await pg.query(sql, params)).rows as Row[];
                if (this.mode === 'one') return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'expected one row' } };
                if (this.mode === 'maybe') return { data: rows[0] ?? null, error: null };
                return { data: rows, error: null };
            } catch (e) {
                return fail(e as Row);
            }
        }
    }

    const client = {
        from: (table: string) => new Query(table),
        async rpc(name: string, args: Row) {
            const keys = Object.keys(args);
            const values = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
            try {
                const sql = `select * from ${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
                return { data: (await pg.query(sql, values)).rows, error: null };
            } catch (e) {
                return fail(e as Row);
            }
        }
    };

    return { pg, client };
}

if (import.meta.main) {
    const { client } = await makeLocalDb();
    // DEV_OWNER=0xabc... makes that wallet own every whale, so the wallet
    // flow can be tested with a throwaway key. Never set on Supabase.
    const devOwner = Deno.env.get('DEV_OWNER')?.toLowerCase();
    const handle = createHandler(client, devOwner ? {
        ownerOf: () => Promise.resolve(devOwner),
        balanceOf: (wallet: string) => Promise.resolve(wallet === devOwner ? 2 : 0)
    } : {});
    if (devOwner) console.log('DEV_OWNER: ' + devOwner + ' owns every whale here');
    const port = Number(Deno.env.get('PORT') ?? 8787);
    Deno.serve({ port, onListen: () => console.log(`Whale Road dev backend on http://localhost:${port}`) }, handle);
}
