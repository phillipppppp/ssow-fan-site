/* ============================================================
   Footer — injected on every page so the links live in one place.

   Brand glyphs are inlined from Simple Icons (CC0), so there is no
   icon-font download and they inherit currentColor.

   EDIT ME: if the Discord invite ever changes, it changes here once.
   ============================================================ */

(function () {
    'use strict';

    var ICONS = {
        discord: 'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z',
        x: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
        opensea: 'M12 0C5.374 0 0 5.374 0 12s5.374 12 12 12 12-5.374 12-12S18.629 0 12 0ZM5.92 12.403l.051-.081 3.123-4.884a.107.107 0 0 1 .187.014c.52 1.169.972 2.623.76 3.528-.088.372-.335.876-.614 1.342a2.405 2.405 0 0 1-.117.199.106.106 0 0 1-.09.045H6.013a.106.106 0 0 1-.091-.163zm13.914 1.68a.109.109 0 0 1-.065.101c-.243.103-1.07.485-1.414.962-.878 1.222-1.548 2.97-3.048 2.97H9.053a4.019 4.019 0 0 1-4.013-4.028v-.072c0-.058.048-.106.108-.106h3.485c.07 0 .12.063.115.132-.026.226.017.459.125.67.206.42.636.682 1.099.682h1.726v-1.347H9.99a.11.11 0 0 1-.089-.173l.063-.09c.16-.231.391-.586.621-.992.156-.274.308-.566.43-.86.024-.052.043-.107.065-.16.033-.094.067-.182.091-.269a4.57 4.57 0 0 0 .065-.223c.057-.25.081-.514.081-.787 0-.108-.004-.221-.014-.327-.005-.117-.02-.235-.034-.352a3.415 3.415 0 0 0-.048-.312 6.494 6.494 0 0 0-.098-.468l-.014-.06c-.03-.108-.056-.21-.09-.317a11.824 11.824 0 0 0-.328-.972 5.212 5.212 0 0 0-.142-.355c-.072-.178-.146-.339-.213-.49a3.564 3.564 0 0 1-.094-.197 4.658 4.658 0 0 0-.103-.213c-.024-.053-.053-.104-.072-.152l-.211-.388c-.029-.053.019-.118.077-.101l1.32.357h.01l.173.05.192.054.07.019v-.783c0-.379.302-.686.679-.686a.66.66 0 0 1 .477.202.69.69 0 0 1 .2.484V6.65l.141.039c.01.005.022.01.031.017.034.024.084.062.147.11.05.038.103.086.165.137a10.351 10.351 0 0 1 .574.504c.214.199.454.432.684.691.065.074.127.146.192.226.062.079.132.156.19.232.079.104.16.212.235.324.033.053.074.108.105.161.096.142.178.288.257.435.034.067.067.141.096.213.089.197.159.396.202.598a.65.65 0 0 1 .029.132v.01c.014.057.019.12.024.184a2.057 2.057 0 0 1-.106.874c-.031.084-.06.17-.098.254-.075.17-.161.343-.264.502-.034.06-.075.122-.113.182-.043.063-.089.123-.127.18a3.89 3.89 0 0 1-.173.221c-.053.072-.106.144-.166.209-.081.098-.16.19-.245.278-.048.058-.1.118-.156.17-.052.06-.108.113-.156.161-.084.084-.15.147-.208.202l-.137.122a.102.102 0 0 1-.072.03h-1.051v1.346h1.322c.295 0 .576-.104.804-.298.077-.067.415-.36.816-.802a.094.094 0 0 1 .05-.03l3.65-1.057a.108.108 0 0 1 .138.103z',
        medium: 'M4.21 0A4.201 4.201 0 0 0 0 4.21v15.58A4.201 4.201 0 0 0 4.21 24h15.58A4.201 4.201 0 0 0 24 19.79v-1.093c-.137.013-.278.02-.422.02-2.577 0-4.027-2.146-4.09-4.832a7.592 7.592 0 0 1 .022-.708c.093-1.186.475-2.241 1.105-3.022a3.885 3.885 0 0 1 1.395-1.1c.468-.237 1.127-.367 1.664-.367h.023c.101 0 .202.004.303.01V4.211A4.201 4.201 0 0 0 19.79 0Zm.198 5.583h4.165l3.588 8.435 3.59-8.435h3.864v.146l-.019.004c-.705.16-1.063.397-1.063 1.254h-.003l.003 10.274c.06.676.424.885 1.063 1.03l.02.004v.145h-4.923v-.145l.019-.005c.639-.144.994-.353 1.054-1.03V7.267l-4.745 11.15h-.261L6.15 7.569v9.445c0 .857.358 1.094 1.063 1.253l.02.004v.147H4.405v-.147l.019-.004c.705-.16 1.065-.397 1.065-1.253V6.987c0-.857-.358-1.094-1.064-1.254l-.018-.004zm19.25 3.668c-1.086.023-1.733 1.323-1.813 3.124H24V9.298a1.378 1.378 0 0 0-.342-.047Zm-1.862 3.632c-.1 1.756.86 3.239 2.204 3.634v-3.634z'
    };

    var SOCIAL = [
        { name: 'Discord', icon: 'discord', href: 'https://discord.com/invite/bbjkvw29VY' },
        { name: 'X',       icon: 'x',       href: 'https://x.com/ssofwhales' },
        { name: 'Medium',  icon: 'medium',  href: 'https://medium.com/@SecretSocietyofWhales' }
    ];

    var COLLECTIONS = [
        { name: 'OG Whales',      href: 'https://opensea.io/collection/secretsocietyofwhales' },
        { name: 'Security Orcas', href: 'https://opensea.io/collection/secret-society-security-orcas' },
        { name: 'Wealthy Whales', href: 'https://opensea.io/collection/ssowwealthywhales' },
        { name: 'Pixel Whales',   href: 'https://opensea.io/collection/secret-society-pixel-whales' },
        { name: 'Collabs',        href: 'https://opensea.io/collection/ssow-collabs' },
        { name: 'Honorary',       href: 'https://opensea.io/collection/ssowhonorarywhales' }
    ];

    function svg(name) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
               '<path fill="currentColor" d="' + ICONS[name] + '"/></svg>';
    }

    function build() {
        var year = new Date().getFullYear();

        var marketplace = COLLECTIONS.map(function (c) {
            return '<li><a href="' + c.href + '" target="_blank" rel="noopener noreferrer">' +
                   c.name + '</a></li>';
        }).join('');

        var social = SOCIAL.map(function (s) {
            return '<a class="Footer-social" href="' + s.href + '" target="_blank" ' +
                   'rel="noopener noreferrer" aria-label="' + s.name + '" title="' + s.name + '">' +
                   svg(s.icon) + '</a>';
        }).join('');

        return '' +
        '<div class="Footer-inner">' +
            '<div class="Footer-col">' +
                '<h2 class="Footer-heading">' + svg('opensea') + ' Collections</h2>' +
                '<ul class="Footer-links">' + marketplace + '</ul>' +
            '</div>' +
            '<div class="Footer-col Footer-col--center">' +
                '<img class="Footer-mark" src="images/favicon-180.png" alt="">' +
                '<p class="Footer-motto">#TogetherWeWhale</p>' +
                '<p class="Footer-blurb">10,000 whales, one pod. Since August 2021.</p>' +
            '</div>' +
            '<div class="Footer-col Footer-col--end">' +
                '<h2 class="Footer-heading">Find the pod</h2>' +
                '<div class="Footer-socials">' + social + '</div>' +
                '<a class="Footer-site" href="https://www.secretsocietyofwhales.com/" ' +
                    'target="_blank" rel="noopener noreferrer">secretsocietyofwhales.com</a>' +
            '</div>' +
        '</div>' +
        '<p class="Footer-legal">' +
            'A community fan project &middot; not affiliated with or endorsed by the SSoW team. ' +
            'Artwork belongs to its holders. &copy; ' + year +
        '</p>';
    }

    function mount() {
        var footer = document.querySelector('[data-footer]');
        if (!footer) return;
        footer.innerHTML = build();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();