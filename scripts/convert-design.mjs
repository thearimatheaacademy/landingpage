// One-off: converts the Claude Design export (Main.dc.html) into the static landing page.
import fs from 'node:fs';
const [src, out] = process.argv.slice(2);
let h = fs.readFileSync(src, 'utf8');
const ids = ['b66ac5f126581396110b34ca15446b23','467acf921f887189287a97ddcd4e7c6d','3ab4341663d5cd45082502d7d113c9b4','3ca8798c4b645f1664858ac5894f30df','b7c79c3b0f0689c742e6cadf03c1c6d3','0f74eda68c38fffec850f30283ab70f2','a76cdda24650ee5c32ef71bed737c566','f547cfd471091192e80fcdf3f051b6ae'];
ids.forEach((id, i) => { h = h.replaceAll(`/_blob/${id}`, `/landing/img/speaker-0${i + 1}.png`); });
h = h.replaceAll('/_blob/15f04a6c0075469047bfc008f1b53e68', '/landing/img/gold-texture.jpg');
h = h.replaceAll('href="https://tinyurl.com/thekingdomway"', 'href="/landing/register/"');
h = h.replace('<script src="./support.js"></script>', '');
h = h.replace(/<script type="text\/x-dc"[\s\S]*?<\/script>/, '');
h = h.replace(/<\/?x-dc>/g, '');
h = h.replace(/<helmet>([\s\S]*?)<\/helmet>/, (_, inner) => { headExtra = inner; return ''; });
var headExtra;
h = h.replace('<meta charset="utf-8">', `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="A 15-week online programme equipping you with spiritual insight and practical knowledge to build your business or ministry. Starts Friday 11 December 2026. £150.">
<meta property="og:title" content="Kingdom School of Business &amp; Ministry Bootcamp">
<meta property="og:image" content="https://thearimatheaacademy.com/landing/img/speaker-03.png">
<link rel="icon" href="/landing/icons/favicon.ico" sizes="32x32"><link rel="icon" href="/landing/icons/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/landing/icons/apple-touch-icon.png">`);
h = h.replace('</head>', headExtra + '</head>');
// lazy-load speaker images below the fold
h = h.replace(/<img /g, '<img loading="lazy" ');
fs.writeFileSync(out, h);
