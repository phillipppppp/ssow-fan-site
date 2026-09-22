/* ============================================================
   Copy this file to  config.js  and paste your key in.

       cp config.example.js config.js

   config.js is loaded by meme.html. If it doesn't exist, the
   caption writer quietly falls back to its built-in templates,
   so the page still works without a key.

   ---- DO NOT SHIP THIS KEY --------------------------------
   Anything in config.js is visible to anyone who opens DevTools
   on the page. Fine on your own machine for a demo. Not fine on
   a public URL — there, delete config.js and put the API call
   behind a small server instead.

   Add config.js to .gitignore before committing anything.
   ------------------------------------------------------------ */

window.WHALE_CONFIG = {
    anthropicApiKey: '',        // sk-ant-api03-...

    /* Only needed if your key is organisation-level rather than
       workspace-scoped. Without it such a key returns:
         "This API key is not scoped to a workspace, so this request
          must include the anthropic-workspace-id header"
       Easier fix: create a workspace-scoped key in the Console and
       leave this blank. */
    anthropicWorkspaceId: ''
};
