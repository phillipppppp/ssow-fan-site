/* Where Whale Road's backend lives.

   Everything here is public by design: the function URL is where the
   page sends runs, and the anon key only lets a browser read the
   leaderboard (row-level security blocks everything else). The
   service-role key never belongs in this file, or anywhere on the site.

   Leave functionUrl empty and the game runs as practice only. */

window.WHALE_ROAD_CONFIG = {
    functionUrl: 'https://brinxceqiczxanmxvoph.supabase.co/functions/v1/whale-road',
    supabaseUrl: 'https://brinxceqiczxanmxvoph.supabase.co',
    anonKey: 'sb_publishable_eKd6uOyrvCBvS9R8wVHlCw_3ij0xk3Y'
};
