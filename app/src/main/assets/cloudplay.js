// CloudPlay page script. Runs at document start on xbox.com and applies the app's settings.
// window.__CP_CFG is prepended by the app.
(function () {
  if (window.__cpInstalled || window.top !== window) return; // main page only
  if (!/(^|\.)xbox\.com$/.test(location.hostname)) return;
  window.__cpInstalled = true;

  var C = window.__CP_CFG || {};
  // With the Better xCloud engine on, it handles stream quality, region, stats and its own
  // touch layouts, so CloudPlay leaves those alone and only adds rumble, clarity and overlays.
  var BX = C.engine === 'betterxcloud';
  // Remote Play: "standard" connects exactly like the Xbox website (works on any network);
  // "direct" adds the console's home addresses for a faster link on the same Wi-Fi.
  // Remote Play connection: "auto" (default) adds your console's direct addresses next to
  // Xbox's own routes, so it connects straight to the console when it can (home Wi-Fi, or
  // directly over the internet) and through Xbox's relay when it can't. "standard" leaves
  // the connection exactly as the Xbox website makes it. (Older "direct" = auto.)
  var RP_MODE = C.remotePlayMode === 'standard' ? 'standard' : 'auto';
  var DIRECT_RP = false;
  window.__cpStockRemotePlay = true;
  // Standard Remote Play runs as the plain Xbox website: no enhancement engine and no
  // stream tweaks on /play/consoles pages, only controller input and rumble.
  var PURE_RP = !DIRECT_RP && /\/play\/consoles/.test(location.pathname);
  window.__cpPureRemote = PURE_RP;
  var ACTIVE = !PURE_RP;
  if (PURE_RP) BX = false;

  // The site switches pages without reloading; crossing into or out of Remote Play does a
  // full load so each side starts clean.
  if (!DIRECT_RP) (function () {
    function isRP(u) {
      try { return /\/play\/consoles/.test(new URL(u, location.href).pathname); } catch (e) { return false; }
    }
    ['pushState', 'replaceState'].forEach(function (m) {
      var orig = history[m];
      history[m] = function (state, title, url) {
        if (url != null && isRP(url) !== PURE_RP) {
          location.assign(new URL(url, location.href).href);
          return;
        }
        return orig.apply(this, arguments);
      };
    });
    window.addEventListener('popstate', function () {
      if (isRP(location.href) !== PURE_RP) location.reload();
    });
    // The site can also change pages through the Navigation API or a router that doesn't go
    // through pushState, so watch the address itself as well.
    if (window.navigation && navigation.addEventListener) {
      navigation.addEventListener('navigatesuccess', function () {
        if (isRP(location.href) !== PURE_RP) location.reload();
      });
    }
    var lastPath = location.pathname;
    setInterval(function () {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      if (isRP(location.href) !== PURE_RP) location.reload();
    }, 300);
  })();
  var OS_NAMES = { '720p': 'android', '1080p': 'windows', '1080p_hq': 'tizen' };
  var H264_PROFILES = { h264_high: '64', h264_main: '4d', h264_baseline: '42' };

  function native() { return window.CloudPlayNative; }
  // Is the enhancement engine actually running (not just selected)? If it failed to start,
  // the app's own engine takes over everything it would have handled.
  function bxOn() { return BX && !!window.__bxMainOk; }

  // Background play: the page always believes it's on screen, so the game isn't paused or
  // ended when you switch apps. The app mutes it while you're away (unless sound is allowed).
  if (C.keepAlive !== false) {
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'visible'; } });
      Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return false; } });
      ['visibilitychange', 'webkitvisibilitychange', 'pagehide', 'freeze'].forEach(function (t) {
        window.addEventListener(t, function (e) { e.stopImmediatePropagation(); }, true);
        document.addEventListener(t, function (e) { e.stopImmediatePropagation(); }, true);
      });
    } catch (e) {}
  }
  var bgMuted = [], bgAway = false;
  window.__cpBackground = function (away) {
    bgAway = away;
    if (C.bgAudio) return;
    try { if (boost.ctx) { if (away) boost.ctx.suspend(); else boost.ctx.resume(); } } catch (e) {}
    if (away) {
      bgMuted = [];
      document.querySelectorAll('video, audio').forEach(function (m) {
        if (!m.muted) { m.muted = true; bgMuted.push(m); }
      });
    } else {
      bgMuted.forEach(function (m) { m.muted = false; });
      bgMuted = [];
    }
  };

  // Keep the Xbox website looking exactly like Microsoft's: the advanced engine only adds
  // settings. Applied once per install (and to existing installs on update); everything
  // stays changeable in Settings afterwards.
  if (BX) {
    try {
      if (!localStorage.getItem('cp.stockUi.v1')) {
        var cur = JSON.parse(localStorage.getItem('BetterXcloud') || '{}');
        var stock = {
          'ui.layout': 'default',
          'ui.theme': 'default',
          'ui.hideSections': [],
          'ui.gameCard.waitTime.show': false,
          'ui.controllerStatus.show': false,
          'ui.hideScrollbar': false,
          'ui.reduceAnimations': false,
          'ui.splashVideo.skip': false,
          'ui.streamMenu.simplify': false,
          'loadingScreen.gameArt.show': false,
          'loadingScreen.waitTime.show': false,
          'loadingScreen.rocket': 'show'
        };
        Object.keys(stock).forEach(function (k) { cur[k] = stock[k]; });
        if (!('stream.video.resolution' in cur)) cur['stream.video.resolution'] = '1080p';
        if (!('block.tracking' in cur)) cur['block.tracking'] = true;
        localStorage.setItem('BetterXcloud', JSON.stringify(cur));
        localStorage.setItem('cp.stockUi.v1', '1');
      }
    } catch (e) {}
    // One-time: no engine touch overlay (the app has its own, shown only without a controller)
    // and no auto stats bar (Stream stats in Advanced settings controls one overlay).
    try {
      if (!localStorage.getItem('cp.stockUi.v2')) {
        var g2 = JSON.parse(localStorage.getItem('BetterXcloud') || '{}');
        g2['touchController.mode'] = 'off';
        localStorage.setItem('BetterXcloud', JSON.stringify(g2));
        var s2 = JSON.parse(localStorage.getItem('BetterXcloud.Stream') || '{}');
        s2['stats.showWhenPlaying'] = false;
        s2['stats.quickGlance.enabled'] = false;
        localStorage.setItem('BetterXcloud.Stream', JSON.stringify(s2));
        localStorage.setItem('cp.stockUi.v2', '1');
      }
    } catch (e) {}

    // Quality settings from App settings: copied over whenever they change there, so the
    // in-page Settings and App settings stay in step (the most recent change wins).
    try {
      var nat = {
        'stream.video.resolution': { auto: 'auto', '720p': '720p', '1080p': '1080p', '1080p_hq': '1080p-hq' }[C.resolution] || 'auto',
        'stream.video.codecProfile': { auto: 'default', h264_high: 'high', h264_main: 'normal', h264_baseline: 'low' }[C.codec] || 'default',
        'stream.video.maxBitrate': (function (kbps) {
          kbps = parseInt(kbps, 10) || 0;
          return (!kbps || kbps >= 15000) ? 0 : Math.round(kbps / 1000 * 1024 * 1000);
        })(C.maxBitrate),
        'server.region': (C.region && C.region !== 'auto') ? C.region : 'default'
      };
      var last = JSON.parse(localStorage.getItem('cp.nativeQuality') || 'null');
      var cur2 = JSON.parse(localStorage.getItem('BetterXcloud') || '{}');
      var changed = false;
      Object.keys(nat).forEach(function (k) {
        if (!last || last[k] !== nat[k]) { cur2[k] = nat[k]; changed = true; }
      });
      if (changed) localStorage.setItem('BetterXcloud', JSON.stringify(cur2));
      localStorage.setItem('cp.nativeQuality', JSON.stringify(nat));
    } catch (e) {}

    // Clarity boost with the Advanced engine runs on the GPU (WebGL2 + AMD CAS sharpening),
    // which stays smooth at 1080p60. Off = the plain video player, the lightest option.
    // Written when the preset changes in the app; in-game tweaks stay until it changes again.
    try {
      var key = [C.clarityPreset, C.sharpness, C.saturation, C.contrast, C.brightness].join('|');
      if (localStorage.getItem('cp.lastClarity') !== key) {
        var st = JSON.parse(localStorage.getItem('BetterXcloud.Stream') || '{}');
        var clamp = function (v) { return Math.max(50, Math.min(150, parseInt(v, 10) || 100)); };
        var sharp = Math.max(0, Math.min(10, parseInt(C.sharpness, 10) || 0));
        var on = (C.clarityPreset || 'off') !== 'off';
        st['video.player.type'] = on && sharp > 0 ? 'webgl2' : 'default';
        st['video.player.powerPreference'] = 'high-performance';
        st['video.processing'] = 'cas';
        st['video.processing.mode'] = 'performance';
        st['video.processing.sharpness'] = on ? sharp : 0;
        st['video.saturation'] = on ? clamp(C.saturation) : 100;
        st['video.contrast'] = on ? clamp(C.contrast) : 100;
        st['video.brightness'] = on ? clamp(C.brightness) : 100;
        localStorage.setItem('BetterXcloud.Stream', JSON.stringify(st));
        localStorage.setItem('cp.lastClarity', key);
      }
    } catch (e) {}

    // Faster artwork: game tiles and backgrounds download as smaller images.
    try {
      var bxs = JSON.parse(localStorage.getItem('BetterXcloud') || '{}');
      var q = C.fastArt === false ? 90 : 70;
      if (bxs['ui.imageQuality'] !== q) {
        bxs['ui.imageQuality'] = q;
        localStorage.setItem('BetterXcloud', JSON.stringify(bxs));
      }
    } catch (e) {}
    // Settings dialog in the same purple frosted-glass style as the app's panels.
    onReady(function () {
      var g = document.createElement('style');
      g.textContent =
        '.bx-settings-tab-contents{background:linear-gradient(135deg,rgba(58,61,94,.86),rgba(44,46,72,.82))!important;' +
        '-webkit-backdrop-filter:blur(28px) saturate(150%);backdrop-filter:blur(28px) saturate(150%);' +
        'box-shadow:0 24px 80px rgba(0,0,0,.45)!important;border-left:1px solid rgba(255,255,255,.14)}' +
        '.bx-settings-tabs svg{background:rgba(44,46,72,.86)!important;border-left-color:transparent!important;' +
        '-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px)}' +
        '.bx-settings-tabs svg.bx-active{background:rgba(196,200,255,.32)!important;border-left-color:#c4c8ff!important}' +
        '.bx-settings-tabs svg:not(.bx-active):hover{background:rgba(196,200,255,.18)!important}' +
        '.bx-settings-row{background:rgba(255,255,255,.06)!important;border-bottom:1px solid rgba(255,255,255,.07)!important}' +
        '.bx-settings-row:hover,.bx-settings-row:focus-within{background:rgba(196,200,255,.24)!important}' +
        '.bx-settings-tab-contents h2{background:transparent!important}' +
        '.bx-settings-dialog a{color:#c4c8ff!important}' +
        '#StreamHud button[title="Stream stats"],#StreamHud div:has(> button[title="Stream stats"]){display:none!important}';
      document.head.appendChild(g);
    });

    // Its own header buttons are replaced by the settings gear next to Search.
    onReady(function () {
      var st = document.createElement('style');
      st.textContent = '.bx-header-settings-button,.bx-header-remote-play-button{display:none !important}';
      document.head.appendChild(st);
    });
  }

  // Look like regular Chrome rather than an in-app WebView (some Xbox features check this).
  if (ACTIVE) try {
    var uad = navigator.userAgentData;
    if (uad && uad.brands && uad.brands.some(function (b) { return /webview/i.test(b.brand); })) {
      var ver = (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1] || '130';
      var brands = [{ brand: 'Chromium', version: ver }, { brand: 'Google Chrome', version: ver },
        { brand: 'Not?A_Brand', version: '99' }];
      var fake = {
        brands: brands, mobile: uad.mobile, platform: uad.platform,
        getHighEntropyValues: function (hints) {
          return uad.getHighEntropyValues(hints).then(function (r) {
            r.brands = brands;
            if (r.fullVersionList) {
              var full = (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || ver;
              r.fullVersionList = brands.map(function (b) { return { brand: b.brand, version: b.brand.indexOf('Not') === 0 ? '99.0.0.0' : full }; });
            }
            return r;
          });
        },
        toJSON: function () { return { brands: brands, mobile: uad.mobile, platform: uad.platform }; }
      };
      Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: function () { return fake; } });
    }
  } catch (e) {}
  // Open connections to the image and game servers right away instead of on first use.
  (function preconnect() {
    var hosts = ['https://store-images.s-microsoft.com', 'https://assets.xboxservices.com',
      'https://catalog.gamepass.com', 'https://xgpuweb.gssv-play-prod.xboxlive.com',
      'https://xgpuwebf2p.gssv-play-prod.xboxlive.com', 'https://emerald.xboxservices.com'];
    function add() {
      var head = document.head || document.documentElement;
      if (!head) return;
      hosts.forEach(function (h) {
        var l = document.createElement('link');
        l.rel = 'preconnect'; l.href = h; l.crossOrigin = 'anonymous';
        head.appendChild(l);
      });
    }
    if (document.documentElement) add(); else document.addEventListener('readystatechange', add, { once: true });
  })();

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  // ================================================================== fetch
  var origFetch = window.fetch;

  async function readBody(input, init) {
    if (init && init.body != null) return typeof init.body === 'string' ? init.body : null;
    if (typeof Request !== 'undefined' && input instanceof Request && input.method === 'POST') {
      try { return await input.clone().text(); } catch (e) {}
    }
    return null;
  }

  function withBody(input, init, body) {
    if (init && init.body != null) return [input, Object.assign({}, init, { body: body })];
    return [new Request(input, { body: body }), init];
  }

  // ------------------------------------------------------------ Remote Play
  // Console streaming ("xhome"). Approach adapted from Better xCloud (MIT, redphx):
  // report a desktop browser, and add the console's own addresses as ICE candidates
  // so the stream can connect directly to the Xbox.
  var consoleAddrs = {};

  function isXhome(url) {
    return url.indexOf('/sessions/home') >= 0 || url.indexOf('xhome.') >= 0 ||
      (location.pathname.indexOf('/play/consoles/launch/') >= 0 && /\/inputconfigs$/.test(url.split('?')[0]));
  }

  function deviceInfo(res) {
    var os = OS_NAMES[res || C.resolution] || 'windows';
    return JSON.stringify({
      appInfo: { env: { clientAppId: location.host, clientAppType: 'browser', clientAppVersion: '26.1.97',
        clientSdkVersion: '10.3.7', httpEnvironment: 'prod', sdkInstallId: '' } },
      dev: {
        os: { name: os, ver: '22631.2715', platform: 'desktop' },
        hw: { make: 'Microsoft', model: 'unknown', sdktype: 'web' },
        browser: { browserName: 'chrome', browserVersion: '140.0.3485.54' },
        displayInfo: { dimensions: { widthInPixels: 4096, heightInPixels: 2160 }, pixelDensity: { dpiX: 1, dpiY: 1 } }
      }
    });
  }

  function patchCandidates(list) {
    var re = /a=candidate:(\d+) (\d+) UDP (\d+) ([^\s]+) (\d+) (.*)/;
    var out = [], n = 1;
    function cand(c) { return { candidate: c, messageType: 'iceCandidate', sdpMLineIndex: '0', sdpMid: '0' }; }
    list.forEach(function (item) {
      var m = re.exec(item.candidate || '');
      if (!m) return;
      out.push(cand('a=candidate:' + n + ' 1 UDP ' + (n === 1 ? 2130706431 : 1) + ' ' + m[4] + ' ' + m[5] + ' ' + m[6]));
      n++;
    });
    Object.keys(consoleAddrs).forEach(function (ip) {
      consoleAddrs[ip].forEach(function (port) {
        out.push(cand('a=candidate:' + (out.length + 1) + ' 1 UDP 1 ' + ip + ' ' + port + ' typ host'));
      });
    });
    out.push(cand('a=end-of-candidates'));
    return out;
  }

  function jsonResponse(res, obj) {
    var h = new Headers(res.headers);
    h.delete('content-length');
    h.delete('content-encoding');
    return new Response(JSON.stringify(obj), { status: res.status, statusText: res.statusText, headers: h });
  }

  async function handleXhome(input, init, url, path) {
    var req = new Request(input, init);
    var headers = new Headers(req.headers);
    headers.set('x-ms-device-info', deviceInfo());
    var opts = { method: req.method, headers: headers };
    if (req.method !== 'GET' && req.method !== 'HEAD') opts.body = await req.clone().text();
    var res = await origFetch(new Request(url, opts));

    try {
      if (url.indexOf('/configuration') >= 0 && res.ok) {
        var cfg = await res.clone().json(), d = cfg.serverDetails || {};
        consoleAddrs = {};
        [['ipAddress', 'port'], ['ipV4Address', 'ipV4Port'], ['ipV6Address', 'ipV6Port']].forEach(function (p) {
          if (!d[p[0]]) return;
          var ports = [];
          if (d[p[1]]) ports.push(d[p[1]]);
          if (ports.indexOf(9002) < 0) ports.push(9002);
          consoleAddrs[d[p[0]]] = ports;
        });
      } else if (/\/ice$/.test(path) && req.method === 'GET' && res.ok) {
        var text = await res.clone().text();
        if (text.length) {
          var obj = JSON.parse(text);
          obj.exchangeResponse = JSON.stringify(patchCandidates(JSON.parse(obj.exchangeResponse)));
          return jsonResponse(res, obj);
        }
      }
    } catch (e) {}
    return res;
  }

  // Remote Play: optional resolution (tells Xbox which kind of device is connecting) and, in
  // Auto mode, extra direct routes to the console. Xbox's own routes are never changed or
  // removed, so it always works anywhere the website works.
  var rpConsole = [];

  function rpAddCandidates(list) {
    if (!rpConsole.length || !Array.isArray(list)) return list;
    var tmpl = list.filter(function (c) { return c && c.sdpMid != null; })[0] || {};
    var end = list.findIndex(function (c) { return /end-of-candidates/.test((c && c.candidate) || ''); });
    var extra = [];
    rpConsole.forEach(function (a, i) {
      var exists = list.some(function (c) { return ((c && c.candidate) || '').indexOf(' ' + a.ip + ' ' + a.port + ' ') >= 0; });
      if (exists) return;
      extra.push({
        candidate: 'a=candidate:' + (91 + i) + ' 1 UDP ' + (2130706431 - i) + ' ' + a.ip + ' ' + a.port + ' typ host',
        messageType: tmpl.messageType || 'iceCandidate',
        sdpMLineIndex: tmpl.sdpMLineIndex != null ? tmpl.sdpMLineIndex : '0',
        sdpMid: tmpl.sdpMid != null ? tmpl.sdpMid : '0'
      });
    });
    if (end < 0) end = list.length;
    return list.slice(0, end).concat(extra, list.slice(end));
  }

  // Remote Play resolution: its own setting if chosen; "Auto" follows the main stream
  // resolution (1080p if that's Auto too). Without this Xbox sees an Android handheld and
  // sends a lower-quality stream. Standard mode only sends it when picked explicitly.
  var RP_STREAM_RES = OS_NAMES[C.rpResolution] ? C.rpResolution
    : RP_MODE === 'standard' ? null
    : '1080p'; // your own console: always ask for full HD (not the cloud setting, which "Lowest latency" drops to 720p)
  if (PURE_RP && (RP_MODE === 'auto' || RP_STREAM_RES)) window.fetch = async function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (!isXhome(url)) return origFetch.call(this, input, init);
    var path = url.split('?')[0];
    var method = ((init && init.method) || (typeof input !== 'string' && input && input.method) || 'GET').toUpperCase();

    var res;
    if (RP_STREAM_RES) {
      var req = new Request(input, init);
      var headers = new Headers(req.headers);
      headers.set('x-ms-device-info', deviceInfo(RP_STREAM_RES));
      var opts = { method: req.method, headers: headers };
      if (req.method !== 'GET' && req.method !== 'HEAD') opts.body = await req.clone().text();
      res = await origFetch(new Request(req.url, opts));
    } else {
      res = await origFetch.call(this, input, init);
    }
    if (RP_MODE !== 'auto' || !res.ok) return res;

    try {
      if (url.indexOf('/configuration') >= 0) {
        var d = (await res.clone().json()).serverDetails || {};
        rpConsole = [];
        [['ipAddress', 'port'], ['ipV4Address', 'ipV4Port'], ['ipV6Address', 'ipV6Port']].forEach(function (k) {
          var ip = d[k[0]];
          if (!ip) return;
          [d[k[1]], 9002].forEach(function (port) {
            if (port && !rpConsole.some(function (a) { return a.ip === ip && a.port === port; })) {
              rpConsole.push({ ip: ip, port: port });
            }
          });
        });
      } else if (/\/ice$/.test(path) && method === 'GET') {
        var text = await res.clone().text();
        if (text) {
          var obj = JSON.parse(text);
          obj.exchangeResponse = JSON.stringify(rpAddCandidates(JSON.parse(obj.exchangeResponse)));
          return jsonResponse(res, obj);
        }
      }
    } catch (e) {}
    return res;
  };

  if (ACTIVE) window.fetch = async function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var path = url.split('?')[0];

    // With the Advanced engine, it handles requests itself; here we only read the server list.
    if (bxOn() && !/\/v2\/login\/user/.test(path)) return origFetch.call(this, input, init);

    if (!bxOn() && isXhome(url)) return DIRECT_RP ? handleXhome(input, init, url, path) : origFetch.call(this, input, init);

    // Stream resolution for cloud games and Remote Play: the server picks quality
    // from the client's reported OS.
    if (!bxOn() && /\/sessions\/cloud\/play$/.test(path) && OS_NAMES[C.resolution]) {
      try {
        var raw = await readBody(input, init);
        if (raw) {
          var b = JSON.parse(raw);
          b.settings = b.settings || {};
          b.settings.osName = OS_NAMES[C.resolution];
          var r = withBody(input, init, JSON.stringify(b));
          input = r[0]; init = r[1];
        }
      } catch (e) {}
    }

    var res = await origFetch.call(this, input, init);

    // Server regions: remember the list, and make the chosen one the default.
    if (/\/v2\/login\/user/.test(path)) {
      try {
        var j = await res.clone().json();
        var regions = j && j.offeringSettings && j.offeringSettings.regions;
        if (regions && regions.length) {
          try { native() && native().setRegions(JSON.stringify(regions.map(function (x) { return x.name; }))); } catch (e) {}
          if (!bxOn() && C.region && C.region !== 'auto' && regions.some(function (x) { return x.name === C.region; })) {
            regions.forEach(function (x) { x.isDefault = x.name === C.region; });
            var h = new Headers(res.headers);
            h.delete('content-length');
            h.delete('content-encoding');
            return new Response(JSON.stringify(j), { status: res.status, statusText: res.statusText, headers: h });
          }
        }
      } catch (e) {}
    }
    return res;
  };

  // ================================================================= WebRTC
  var pcs = [];
  var PC = window.RTCPeerConnection;

  function streaming() {
    return pcs.some(function (p) { return p.connectionState === 'connected'; });
  }

  function applyCodec(pc, codec) {
    var want = H264_PROFILES[codec || C.codec];
    if (!want || !window.RTCRtpReceiver || !RTCRtpReceiver.getCapabilities) return;
    var caps = RTCRtpReceiver.getCapabilities('video');
    if (!caps) return;
    function score(c) {
      if (c.mimeType.toLowerCase() !== 'video/h264') return 0;
      return (c.sdpFmtpLine || '').toLowerCase().indexOf('profile-level-id=' + want) >= 0 ? 2 : 1;
    }
    var codecs = caps.codecs.slice().sort(function (a, b) { return score(b) - score(a); });
    if (score(codecs[0]) < 2) return; // device can't decode that profile
    pc.getTransceivers().forEach(function (t) {
      if (t.receiver && t.receiver.track && t.receiver.track.kind === 'video' && t.setCodecPreferences) {
        try { t.setCodecPreferences(codecs); } catch (e) {}
      }
    });
  }

  function limitBitrate(sdp) {
    var kbps = parseInt(C.maxBitrate, 10) || 0;
    if (!kbps) return sdp;
    var lines = sdp.split('\r\n'), out = [], inVideo = false;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l.indexOf('m=') === 0) inVideo = l.indexOf('m=video') === 0;
      if (inVideo && l.indexOf('b=AS:') === 0) continue;
      out.push(l);
      if (inVideo && l.indexOf('c=') === 0) out.push('b=AS:' + kbps);
    }
    return out.join('\r\n');
  }

  if (PC && PC.prototype.createOffer) {
    var origCreateOffer = PC.prototype.createOffer;
    PC.prototype.createOffer = async function () {
      if (pcs.indexOf(this) < 0) pcs.push(this); // used to know when a stream is live
      if (!bxOn() && ACTIVE) { try { applyCodec(this); } catch (e) {} }
      // Remote Play: prefer H.264 High profile (sharper at the same bitrate). Only a preference
      // order; if the console doesn't offer it, the stream uses what it does.
      else if (PURE_RP && RP_MODE === 'auto') {
        try { applyCodec(this, C.codec && C.codec !== 'auto' ? C.codec : 'h264_high'); } catch (e) {}
      }
      var offer = await origCreateOffer.apply(this, arguments);
      if (!bxOn() && ACTIVE) {
        try {
          if (offer && offer.sdp) offer = { type: offer.type, sdp: limitBitrate(offer.sdp) };
        } catch (e) {}
      }
      return offer;
    };
  }

  // ========================================================= clarity boost
  // Two algorithms: a 3x3 sharpen kernel, and an unsharp mask (blur + subtract).
  // Sharpening level for the GPU pass (0 = off). The enhancement engine does its own.
  function gpuLevel() {
    if (bxOn()) return 0;
    if (PURE_RP) return ({ off: 0, low: 3, medium: 5, high: 7 })[C.rpSharpen || 'medium'] || 0;
    return Math.max(0, Math.min(10, parseInt(C.sharpness, 10) || 0));
  }

  function applyVideoStyle() {
    var old = document.getElementById('cp-style'); if (old) old.remove();
    var oldSvg = document.getElementById('cp-svg'); if (oldSvg) oldSvg.remove();

    var gpuOn = gpuLevel() > 0 && gpuSupported();
    var filters = [];
    // Colour tweaks: done inside the GPU pass when it runs, otherwise as cheap CSS filters.
    if (!gpuOn && !bxOn()) {
      if (C.saturation && C.saturation !== 100) filters.push('saturate(' + C.saturation / 100 + ')');
      if (C.contrast && C.contrast !== 100) filters.push('contrast(' + C.contrast / 100 + ')');
      if (C.brightness && C.brightness !== 100) filters.push('brightness(' + C.brightness / 100 + ')');
    }
    var style = document.createElement('style');
    style.id = 'cp-style';
    style.textContent = 'video{' + (bxOn() ? '' : 'object-fit:' + (C.videoFit || 'contain') + ' !important;') +
      (filters.length ? 'filter:' + filters.join(' ') + ' !important;' : '') + '}' +
      'html,body{overscroll-behavior:none;}';
    (document.head || document.documentElement).appendChild(style);
    if (gpu) gpu.settingsChanged = true;
  }

  // ============================================================ GPU picture
  // Each video frame is drawn through a WebGL2 pass on the graphics chip: contrast-adaptive
  // sharpening (restores detail softened by video compression, without halos) plus the
  // saturation / contrast / brightness settings. Runs per decoded frame, so no added delay.
  var gpu = null, gpuOk = null;
  function gpuSupported() {
    if (gpuOk === null) {
      try { gpuOk = !!document.createElement('canvas').getContext('webgl2'); } catch (e) { gpuOk = false; }
    }
    return gpuOk;
  }

  var GPU_VS = '#version 300 es\nin vec2 p;out vec2 uv;uniform vec4 crop;' +
    'void main(){uv=crop.xy+(p*0.5+0.5)*crop.zw;uv.y=1.0-uv.y;gl_Position=vec4(p,0.0,1.0);}';
  var GPU_FS = '#version 300 es\nprecision highp float;in vec2 uv;out vec4 o;' +
    'uniform sampler2D t;uniform vec2 px;uniform float amt;uniform vec3 col;' +
    'void main(){' +
    'vec3 c=texture(t,uv).rgb;' +
    'vec3 n=texture(t,uv+vec2(0.0,-px.y)).rgb,w=texture(t,uv+vec2(-px.x,0.0)).rgb,' +
    'e=texture(t,uv+vec2(px.x,0.0)).rgb,s=texture(t,uv+vec2(0.0,px.y)).rgb;' +
    'vec3 mn=min(c,min(min(n,s),min(w,e)));vec3 mx=max(c,max(max(n,s),max(w,e)));' +
    // sharpen less where local contrast is already high (no halos / ringing)
    'vec3 k=sqrt(clamp(min(mn,1.0-mx)/max(mx,vec3(1e-4)),0.0,1.0));' +
    'vec3 wt=-k*amt;' +
    'vec3 r=clamp((c+(n+s+w+e)*wt)/(1.0+4.0*wt),0.0,1.0);' +
    'r*=col.z;r=(r-0.5)*col.y+0.5;float l=dot(r,vec3(0.2126,0.7152,0.0722));' +
    'r=mix(vec3(l),r,col.x);o=vec4(clamp(r,0.0,1.0),1.0);}';

  function mainVideo() {
    var best = null, area = 0;
    document.querySelectorAll('video').forEach(function (v) {
      if (!v.srcObject && !v.src) return;
      var r = v.getBoundingClientRect(), a = r.width * r.height;
      if (a > area) { area = a; best = v; }
    });
    return area > 20000 ? best : null;
  }

  function gpuStart(video) {
    var canvas = document.createElement('canvas');
    canvas.className = 'cp-gpu';
    canvas.style.cssText = 'position:absolute;pointer-events:none;margin:0;padding:0;border:0;';
    var gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false,
      desynchronized: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) return null;
    function sh(type, src) {
      var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o));
      return o;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, GPU_VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, GPU_FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(function (k) { gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR); });
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (k) { gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE); });
    var U = {};
    ['crop', 'px', 'amt', 'col'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

    var g = { video: video, canvas: canvas, gl: gl, prog: prog, U: U, handle: 0, alive: true, settingsChanged: true };
    video.insertAdjacentElement('afterend', canvas);

    function layout() {
      var vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return;
      var ew = video.clientWidth, eh = video.clientHeight;
      var fit = C.videoFit || 'contain', cw = ew, ch = eh, crop = [0, 0, 1, 1];
      if (fit === 'contain') {
        var sc = Math.min(ew / vw, eh / vh); cw = vw * sc; ch = vh * sc;
      } else if (fit === 'cover') {
        var sv = Math.max(ew / vw, eh / vh), uw = ew / (vw * sv), uh = eh / (vh * sv);
        crop = [(1 - uw) / 2, (1 - uh) / 2, uw, uh];
      }
      var st = canvas.style;
      st.left = (video.offsetLeft + (ew - cw) / 2) + 'px';
      st.top = (video.offsetTop + (eh - ch) / 2) + 'px';
      st.width = cw + 'px'; st.height = ch + 'px';
      if (canvas.width !== vw || canvas.height !== vh) { canvas.width = vw; canvas.height = vh; }
      gl.viewport(0, 0, vw, vh);
      gl.uniform4f(U.crop, crop[0], crop[1], crop[2], crop[3]);
      gl.uniform2f(U.px, 1 / vw, 1 / vh);
    }
    g.layout = layout;

    function draw() {
      if (!g.alive) return;
      if (video.readyState >= 2) {
        if (g.settingsChanged) {
          g.settingsChanged = false;
          var lvl = gpuLevel();
          // 0..10 -> 0..0.2 sharpening weight (0.2 is strong)
          gl.uniform1f(U.amt, lvl / 50);
          var sat = PURE_RP ? 1 : (C.saturation || 100) / 100;
          var con = PURE_RP ? 1 : (C.contrast || 100) / 100;
          var bri = PURE_RP ? 1 : (C.brightness || 100) / 100;
          gl.uniform3f(U.col, sat, con, bri);
          layout();
        }
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        } catch (e) {}
      }
      schedule();
    }
    function schedule() {
      if (!g.alive) return;
      if (video.requestVideoFrameCallback) g.handle = video.requestVideoFrameCallback(draw);
      else g.handle = requestAnimationFrame(draw);
    }
    g.stop = function () {
      g.alive = false;
      try { if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(g.handle); else cancelAnimationFrame(g.handle); } catch (e) {}
      canvas.remove();
      try { var ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e) {}
    };
    schedule();
    return g;
  }

  // Attach to the playing stream (and re-attach when it changes); follow size changes.
  setInterval(function () {
    var want = gpuLevel() > 0 && gpuSupported() && !!lastStreaming;
    var v = want ? mainVideo() : null;
    if (gpu && (!want || gpu.video !== v || !gpu.canvas.isConnected)) { gpu.stop(); gpu = null; }
    if (!gpu && v) { try { gpu = gpuStart(v); } catch (e) { gpu = null; gpuOk = false; applyVideoStyle(); } }
    if (gpu) gpu.layout();
  }, 1000);
  window.addEventListener('resize', function () { if (gpu) gpu.settingsChanged = true; });

  onReady(applyVideoStyle);

  // Called by the app to switch clarity presets live, without reloading.
  window.__cpSetVideo = function (v) {
    Object.assign(C, v || {});
    onReady(applyVideoStyle);
  };

  // ================================================================= rumble
  var rumbleOn = !!(C.rumble && C.rumble !== 'off');
  var actuator = {
    type: 'dual-rumble',
    effects: ['dual-rumble', 'trigger-rumble'],
    canPlayEffectType: function (t) { return t === 'dual-rumble' || t === 'trigger-rumble'; },
    playEffect: function (type, p) {
      p = p || {};
      var d = Math.max(0, p.duration || 0), delay = Math.max(0, p.startDelay || 0);
      var s = p.strongMagnitude || 0, w = p.weakMagnitude || 0;
      if (type === 'trigger-rumble') {
        s = Math.max(s, p.leftTrigger || 0);
        w = Math.max(w, p.rightTrigger || 0);
      }
      return new Promise(function (resolve) {
        setTimeout(function () {
          try { native() && native().rumble(Math.round(d), s, w); } catch (e) {}
          setTimeout(function () { resolve('complete'); }, d);
        }, delay);
      });
    },
    reset: function () {
      try { native() && native().stopRumble(); } catch (e) {}
      return Promise.resolve('complete');
    }
  };

  // ========================================================= touch controls
  var touchOn = C.touchMode === 'always' || (C.touchMode === 'auto' && !BX);
  var VPAD_ID = 'Touch Controller (STANDARD GAMEPAD Vendor: 045e Product: 02ea)';
  var vpad = {
    id: VPAD_ID, index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0], buttons: [], vibrationActuator: actuator, hapticActuators: []
  };
  for (var bi = 0; bi < 17; bi++) vpad.buttons.push({ pressed: false, touched: false, value: 0 });
  var vpadActive = false;

  function press(i, down) {
    var b = vpad.buttons[i];
    b.pressed = b.touched = down;
    b.value = down ? 1 : 0;
    vpad.timestamp = performance.now();
  }
  function setAxis(i, v) { vpad.axes[i] = v; vpad.timestamp = performance.now(); }
  function releaseAll() {
    for (var i = 0; i < vpad.buttons.length; i++) press(i, false);
    for (var a = 0; a < 4; a++) setAxis(a, 0);
  }

  // ======================================================= gamepad plumbing
  // Controllers come from two places: WebView's own Gamepad API (not on every device),
  // and the app's native bridge, which reads controllers straight from Android.
  var nav = navigator;
  var origGetGamepads = nav.getGamepads ? nav.getGamepads.bind(nav) : null;
  var inputMode = C.controllerInput || 'auto';

  function realPads() {
    var out = [];
    if (!origGetGamepads || inputMode === 'bridge') return out;
    try {
      var list = origGetGamepads() || [];
      for (var i = 0; i < list.length; i++) out.push(list[i] || null);
    } catch (e) {}
    return out;
  }

  // The app pushes controller changes here the moment they happen (window.__cpPads), so
  // reading the controller (up to 250 times a second in-game) never waits on the app.
  var bridgeVer = -1, bridgeObjs = {};
  function bridgePads() { return bridgeObjs; }

  function pullBridge() { // fallback/initial sync only
    var n = native();
    if (inputMode === 'webview' || !n || !n.padVersion) return;
    var v = n.padVersion();
    if (v === bridgeVer) return;
    try { applyBridge(v, JSON.parse(n.padState())); } catch (e) {}
  }

  window.__cpPads = function (v, arr) {
    if (inputMode === 'webview') return;
    applyBridge(v, arr);
  };

  function applyBridge(v, arr) {
    bridgeVer = v;
    var seen = {};
    arr.forEach(function (p) {
      var o = bridgeObjs[p.i], isNew = !o;
      if (!o) {
        o = bridgeObjs[p.i] = {
          id: p.id, index: p.i, connected: true, mapping: 'standard', timestamp: performance.now(),
          axes: [0, 0, 0, 0], buttons: [], vibrationActuator: actuator, hapticActuators: [], _t: -1
        };
        for (var k = 0; k < 17; k++) o.buttons.push({ pressed: false, touched: false, value: 0 });
      }
      if (o._t !== p.t) {
        o._t = p.t;
        o.timestamp = performance.now();
        var swap = C.buttonLayout === 'nintendo';
        for (var b = 0; b < 17; b++) {
          var srcB = swap ? ({ 0: 1, 1: 0, 2: 3, 3: 2 })[b] : undefined;
          var val = p.b[srcB != null ? srcB : b] || 0, btn = o.buttons[b];
          btn.value = val;
          btn.pressed = btn.touched = val > 0.12;
        }
        var dz = Math.max(0, Math.min(0.3, (C.deadzone != null ? +C.deadzone : 5) / 100));
        for (var a = 0; a < 4; a++) {
          var av = p.a[a] || 0;
          var mag = Math.abs(av);
          av = mag <= dz ? 0 : Math.sign(av) * (mag - dz) / (1 - dz); // rescaled radial-ish deadzone
          if (a === 3 && C.invertY) av = -av;
          o.axes[a] = av;
        }
      }
      seen[p.i] = 1;
      if (isNew) announce('gamepadconnected', o);
    });
    Object.keys(bridgeObjs).forEach(function (k) {
      if (!seen[k]) {
        var o = bridgeObjs[k];
        o.connected = false;
        delete bridgeObjs[k];
        announce('gamepaddisconnected', o);
      }
    });
  }

  function realPadConnected() {
    return Object.keys(bridgePads()).length > 0 || realPads().some(function (p) { return p && p.connected; });
  }

  Object.defineProperty(nav, 'getGamepads', {
    configurable: true,
    value: function () {
      var list = [null, null, null, null];
      var bp = bridgePads(), bridged = Object.keys(bp);
      if (bridged.length) {
        bridged.forEach(function (k) { list[k] = bp[k]; });
      } else {
        realPads().forEach(function (gp, i) {
          if (!gp) return;
          // Keep the real Gamepad object; only attach the app's rumble to it.
          if (rumbleOn) {
            try { Object.defineProperty(gp, 'vibrationActuator', { configurable: true, value: actuator }); } catch (e) {}
          }
          list[i] = gp;
        });
      }
      if (menuOpen) {
        return list.map(function (gp) { return gp ? neutral(gp) : null; });
      }
      if (vpadActive) {
        var slot = list.indexOf(null);
        if (slot < 0) slot = list.length;
        vpad.index = slot;
        list[slot] = vpad;
      }
      return list;
    }
  });

  var menuOpen = false, neutralCache = {};
  function neutral(gp) {
    var n = neutralCache[gp.index];
    if (!n) {
      n = neutralCache[gp.index] = { id: gp.id, index: gp.index, connected: true, mapping: 'standard',
        timestamp: performance.now(), axes: [0, 0, 0, 0], buttons: [], vibrationActuator: actuator, hapticActuators: [] };
      for (var k = 0; k < 17; k++) n.buttons.push({ pressed: false, touched: false, value: 0 });
    }
    return n;
  }
  // Raw controller state for the settings panel (bypasses the neutral copies above).
  function rawPads() {
    var bp = bridgePads(), keys = Object.keys(bp);
    if (keys.length) return keys.map(function (k) { return bp[k]; });
    return realPads().filter(function (p) { return p; });
  }

  function announce(type, pad) {
    try {
      var ev = new Event(type);
      Object.defineProperty(ev, 'gamepad', { value: pad || vpad });
      window.dispatchEvent(ev);
    } catch (e) {}
  }

  // Initial sync, plus a slow safety net in case a push was missed.
  pullBridge();
  setInterval(pullBridge, 1000);

  // ========================================================== quick access
  // Tell the app when a game is streaming (it hides the floating gear then).
  var lastStreaming = null;
  setInterval(function () {
    var on = streaming() || location.pathname.indexOf('/launch/') >= 0;
    if (on !== lastStreaming) {
      lastStreaming = on;
      try { native() && native().setStreaming(on); } catch (e) {}
    }
  }, 700);

  // ================================================================ settings
  // A gear in the Xbox header (cloned from the site's own Search button so it matches),
  // opening a panel styled like the site's Settings screen.
  var GEAR_PATH = 'M19.14,12.94c0.04,-0.3 0.06,-0.61 0.06,-0.94c0,-0.32 -0.02,-0.64 -0.07,-0.94l2.03,-1.58c0.18,-0.14 0.23,-0.41 0.12,-0.61l-1.92,-3.32c-0.12,-0.22 -0.37,-0.29 -0.59,-0.22l-2.39,0.96c-0.5,-0.38 -1.03,-0.7 -1.62,-0.94L14.4,2.81c-0.04,-0.24 -0.24,-0.41 -0.48,-0.41h-3.84c-0.24,0 -0.43,0.17 -0.47,0.41L9.25,5.35C8.66,5.59 8.12,5.92 7.63,6.29L5.24,5.33c-0.22,-0.08 -0.47,0 -0.59,0.22L2.74,8.87C2.62,9.08 2.66,9.34 2.86,9.48l2.03,1.58C4.84,11.36 4.8,11.69 4.8,12s0.02,0.64 0.07,0.94l-2.03,1.58c-0.18,0.14 -0.23,0.41 -0.12,0.61l1.92,3.32c0.12,0.22 0.37,0.29 0.59,0.22l2.39,-0.96c0.5,0.38 1.03,0.7 1.62,0.94l0.36,2.54c0.05,0.24 0.24,0.41 0.48,0.41h3.84c0.24,0 0.44,-0.17 0.47,-0.41l0.36,-2.54c0.59,-0.24 1.13,-0.56 1.62,-0.94l2.39,0.96c0.22,0.08 0.47,0 0.59,-0.22l1.92,-3.32c0.12,-0.22 0.07,-0.47 -0.12,-0.61L19.14,12.94zM12,15.6c-1.98,0 -3.6,-1.62 -3.6,-3.6s1.62,-3.6 3.6,-3.6s3.6,1.62 3.6,3.6S13.98,15.6 12,15.6z';
  var SVGNS = 'http://www.w3.org/2000/svg';

  function gearSvg(like) {
    var svg = document.createElementNS(SVGNS, 'svg');
    if (like) {
      ['class', 'width', 'height', 'style', 'aria-hidden'].forEach(function (a) {
        var v = like.getAttribute(a); if (v != null) svg.setAttribute(a, v);
      });
    } else {
      svg.setAttribute('width', '24'); svg.setAttribute('height', '24');
    }
    svg.setAttribute('viewBox', '0 0 24 24');
    var path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', GEAR_PATH);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  // Icon-only buttons in the top bar (search, devices, controller...). The gear goes after
  // the right-most one, i.e. just left of the profile picture / Sign in.
  function topBar() {
    return document.querySelector('header, [role="banner"]') || document.body;
  }

  function isTopIcon(el) {
    if (el.classList.contains('cp-header-gear') || !el.querySelector('svg') || el.querySelector('img')) return null;
    if (el.closest('#StreamHud, .cp-hud-gear, .cpm-backdrop')) return null;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.width > 90 || r.top > 140 || r.top < -10) return null;
    return r;
  }

  function rightmostTopIcon() {
    var best = null, bestR = null;
    // Whole page: on some pages the top bar sits over the hero art, outside any <header>.
    document.querySelectorAll('button, a').forEach(function (el) {
      var r = isTopIcon(el);
      if (r && (!bestR || r.right > bestR.right)) { best = el; bestR = r; }
    });
    return best;
  }

  function cleanClone(src) {
    var btn = src.cloneNode(true);
    var oldSvg = btn.querySelector('svg');
    // Drop everything that isn't on the path to the icon (tooltips, labels, badges).
    Array.prototype.slice.call(btn.querySelectorAll('*')).forEach(function (el) {
      if (!btn.contains(el) || el === oldSvg || oldSvg.contains(el) || el.contains(oldSvg)) return;
      el.remove();
    });
    Array.prototype.slice.call(btn.attributes).forEach(function (a) {
      if (/^(id|href|aria-|data-|title|target|rel)/.test(a.name)) btn.removeAttribute(a.name);
    });
    btn.querySelectorAll('[id],[aria-describedby]').forEach(function (el) {
      el.removeAttribute('id'); el.removeAttribute('aria-describedby');
    });
    oldSvg.parentNode.replaceChild(gearSvg(oldSvg), oldSvg);
    return btn;
  }

  var headerReported = null;
  function ensureHeaderGear() {
    if (lastStreaming || location.pathname.indexOf('/launch/') >= 0) { // in-game: no header gear
      var g0 = document.querySelector('.cp-header-gear');
      if (g0) g0.remove();
      return;
    }
    var existing = document.querySelector('.cp-header-gear');
    // Cheap check first: still attached next to the same kind of icon, and nothing to its right.
    var ok = existing && existing.isConnected && existing.previousElementSibling &&
      isTopIcon(existing.previousElementSibling) && !(existing.nextElementSibling && isTopIcon(existing.nextElementSibling));
    if (!ok) {
      var anchor = rightmostTopIcon();
      if (existing) existing.remove();
      existing = null;
      if (anchor) {
        var btn = cleanClone(anchor);
        btn.classList.add('cp-header-gear');
        btn.setAttribute('role', 'button');
        btn.setAttribute('tabindex', '0');
        btn.setAttribute('aria-label', 'Settings');
        btn.addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation(); openSettingsUi();
        }, true);
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
        existing = btn;
      }
    }
    var present = !!existing;
    if (present !== headerReported) {
      headerReported = present;
      try { native() && native().setHeaderButton(present); } catch (e) {}
    }
  }
  onReady(function () { setInterval(ensureHeaderGear, 1000); ensureHeaderGear(); });

  var CHEVRON = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CHECK = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CLARITY = [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['vivid', 'Vivid'], ['custom', 'Custom']];

  function remotePlayUrl() {
    var m = location.pathname.match(/^\/([a-z]{2}-[a-z]{2})\//i);
    return 'https://www.xbox.com/' + (m ? m[1] : 'en-US') + '/play/consoles';
  }

  var menuEl = null, rows = [], focusIdx = 0, page = 'main', rootPage = 'main', padTimer = null;

  // Remote Play settings: picture options apply instantly (display only); resolution and
  // connection apply the next time you connect to your console.
  var FITS = [['contain', 'Fit'], ['cover', 'Zoom to fill'], ['fill', 'Stretch']];
  var RP_RES = [['auto', 'Auto (1080p)'], ['720p', '720p'], ['1080p', '1080p'], ['1080p_hq', '1080p HQ']];
  function nextOf(list, cur) {
    var i = list.findIndex(function (x) { return x[0] === cur; });
    return list[(i + 1) % list.length];
  }
  function nameOf(list, cur) { return (list.filter(function (x) { return x[0] === cur; })[0] || list[0])[1]; }
  function savePref(key, value) { try { native() && native().setPref(key, String(value)); } catch (e) {} }

  function remoteItems() {
    return [
      { label: 'Clarity boost', detail: clarityName(C.clarityPreset || 'off'), go: function () { render('clarity'); } },
      { label: 'Screen fit', detail: nameOf(FITS, C.videoFit || 'contain'), go: function () {
        var n = nextOf(FITS, C.videoFit || 'contain');
        C.videoFit = n[0]; savePref('video_fit', n[0]); applyVideoStyle(); render('remote', focusIdx);
      } },
      { label: 'Stream stats', detail: C.showStats ? 'On' : 'Off', go: function () {
        C.showStats = !C.showStats; savePref('show_stats', C.showStats); render('remote', focusIdx);
      } },
      { label: 'Sharpening', sub: 'Crisper picture, done on the graphics chip',
        detail: nameOf([['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], C.rpSharpen || 'medium'), go: function () {
        var n = nextOf([['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], C.rpSharpen || 'medium');
        C.rpSharpen = n[0]; savePref('rp_sharpen', n[0]); applyVideoStyle(); render('remote', focusIdx);
      } },
      { label: 'Resolution', sub: 'Applies next time you connect', detail: nameOf(RP_RES, C.rpResolution || 'auto'), go: function () {
        var n = nextOf(RP_RES, C.rpResolution || 'auto');
        C.rpResolution = n[0]; savePref('rp_resolution', n[0]); render('remote', focusIdx);
      } },
      { label: 'Connection', sub: 'Applies next time you connect',
        detail: C.remotePlayMode === 'standard' ? 'Standard' : 'Auto (fastest)', go: function () {
        C.remotePlayMode = C.remotePlayMode === 'standard' ? 'auto' : 'standard';
        savePref('remote_play_mode', C.remotePlayMode); render('remote', focusIdx);
      } },
      { label: 'Touch controls', sub: 'Show or hide on-screen buttons', go: function () { close(); window.__cpTouch && __cpTouch.toggle(); } },
      { label: 'App settings', go: function () { close(); native() && native().openSettings(); } },
      { label: 'Exit app', go: function () { native() && native().exitApp(); } }
    ];
  }

  // Gear in the in-game bar (next to the Xbox and controller buttons), cloned from the bar's
  // own button so it matches. Used wherever the enhancement engine isn't adding its own.
  function findHud() {
    return document.getElementById('StreamHud') ||
      document.querySelector('[id*="StreamHud" i], [class*="StreamHud" i], [data-testid*="stream-hud" i]');
  }

  function ensureHudGear() {
    var hud = findHud();
    if (!hud) return;
    // The engine's own button (titled "Settings") may come and go as Xbox redraws the bar;
    // whenever it's missing, ours is there instead, so a gear is always available.
    var engineBtn = hud.querySelector('button[title="Settings"]:not(.cp-hud-btn)');
    var mine = hud.querySelector('.cp-hud-gear');
    if (engineBtn) { if (mine) mine.remove(); return; }
    if (mine) return;
    var org = hud.querySelector('div[class^=HUDButton], div[class*="HUDButton"]');
    if (!org) { var anyBtn = hud.querySelector('button svg'); org = anyBtn && anyBtn.closest('button').parentElement; }
    var btnOrg = org && org.querySelector('button');
    var svgOrg = btnOrg && btnOrg.querySelector('svg');
    if (!svgOrg) return;
    var box = org.cloneNode(true);
    box.classList.add('cp-hud-gear');
    var b = box.querySelector('button');
    b.classList.add('cp-hud-btn');
    b.setAttribute('title', 'Settings');
    b.setAttribute('aria-label', 'Settings');
    b.removeAttribute('id');
    var svg = box.querySelector('svg');
    var g = gearSvg(svg);
    g.style.fill = 'none';
    svg.parentNode.replaceChild(g, svg);
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (PURE_RP) window.__cpMenu.open(); else openSettingsUi();
    }, true);
    var parent = org.parentElement;
    parent.insertBefore(box, parent.lastElementChild);
  }
  onReady(function () {
    setInterval(function () { if (lastStreaming) ensureHudGear(); }, 500);
    // React to the bar being redrawn right away, not just on the timer.
    var watched = null;
    setInterval(function () {
      var hud = findHud();
      if (!hud || hud === watched) return;
      watched = hud;
      new MutationObserver(function () { ensureHudGear(); }).observe(hud, { childList: true, subtree: true });
    }, 1000);
  });

  function mainItems() {
    var preset = (CLARITY.filter(function (c) { return c[0] === (C.clarityPreset || 'off'); })[0] || CLARITY[0])[1];
    var items = [
      { label: 'Advanced settings', sub: 'Stream quality, picture, audio, controller, touch', go: function () { render('advanced'); } },
      { label: 'Clarity boost', detail: preset, go: function () { render('clarity'); } },
      { label: 'Remote Play', sub: 'Play games installed on your Xbox console', go: function () { close(); location.href = remotePlayUrl(); } }
    ];
    if (bxOn()) items.push({ label: 'Better xCloud settings', sub: 'Upscaling, mouse & keyboard and more', go: function () {
      close(); setTimeout(function () { if (window.__cpOpenBx) __cpOpenBx(); }, 60);
    } });
    items.push(
      { label: 'Edit touch layout', go: function () { close(); window.__cpTouch && __cpTouch.edit(); } },
      { label: 'App settings', sub: 'Everything else, in the full settings screen', go: function () { close(); native() && native().openSettings(); } },
      { label: 'Reload', go: function () { location.reload(); } },
      { label: 'Exit', go: function () { native() && native().exitApp(); } }
    );
    return items;
  }

  // ---- Advanced settings: every option implemented by the app itself, so it works whether
  // or not the enhancement engine runs. Left/right (or tap) changes a value.
  function savePref(key, value, type) {
    try { native() && native().setPrefTyped(key, String(value), type || 's'); } catch (e) {}
  }
  function choice(label, key, cfgKey, opts, opt) {
    opt = opt || {};
    var cur = C[cfgKey] != null ? String(C[cfgKey]) : String(opts[0][0]);
    var idx = Math.max(0, opts.findIndex(function (o) { return String(o[0]) === cur; }));
    return { label: label, sub: opt.sub, detail: opts[idx][1], adjustable: true, adjust: function (d) {
      var n = opts[(idx + d + opts.length) % opts.length];
      C[cfgKey] = n[0]; savePref(key, n[0], opt.type || 's');
      if (opt.live) opt.live(n[0]);
      if (opt.reconnect) needReconnect();
    } };
  }
  function stepper(label, key, cfgKey, min, max, step, suffix, opt) {
    opt = opt || {};
    var cur = parseInt(C[cfgKey], 10); if (isNaN(cur)) cur = opt.def != null ? opt.def : min;
    var shown = opt.fmt ? opt.fmt(cur) : cur + (suffix || '');
    return { label: label, sub: opt.sub, detail: shown, adjustable: true, adjust: function (d) {
      var v = Math.max(min, Math.min(max, cur + d * step));
      C[cfgKey] = v; savePref(key, v, 'i');
      if (opt.live) opt.live(v);
    } };
  }
  function toggle(label, key, cfgKey, opt) {
    opt = opt || {};
    var on = !!C[cfgKey];
    return { label: label, sub: opt.sub, detail: on ? 'On' : 'Off', adjustable: true, adjust: function () {
      C[cfgKey] = !on; savePref(key, !on, 'b');
      if (opt.live) opt.live(!on);
    } };
  }
  function regionOpts() {
    var list = [['auto', 'Auto (closest)']];
    (C.regions || []).forEach(function (r) { list.push([r, r]); });
    return list;
  }
  // Stream settings (resolution, codec, bitrate, server) are fixed when a stream starts. Changed
  // mid-game, the stream reconnects as soon as the panel closes, so they apply right away.
  var pendingReconnect = false;
  function nextText() {
    return lastStreaming ? 'Applies right away (the stream reconnects for a moment)' : 'Applies when the next game starts';
  }
  function needReconnect() { if (lastStreaming) pendingReconnect = true; }
  function livePicture() { C.clarityPreset = 'custom'; savePref('clarity_preset', 'custom', 's'); applyVideoStyle(); }

  function advancedItems() {
    var NEXT = nextText();
    return [
      { header: 'Latency' },
      choice('Latency', 'latency_mode', 'latencyMode', [['balanced', 'Balanced'], ['lowest', 'Lowest']], {
        sub: 'Lowest: 720p and no video buffer for the quickest response',
        reconnect: true,
        live: function (v) {
          var low = v === 'lowest';
          C.resolution = low ? '720p' : '1080p'; savePref('resolution', C.resolution, 's');
          C.lowLatency = low; savePref('low_latency', low, 'b');
        }
      }),
      { header: 'Stream' },
      choice('Resolution', 'resolution', 'resolution', [['auto', 'Auto'], ['720p', '720p'], ['1080p', '1080p'], ['1080p_hq', '1080p HQ']], { sub: NEXT, reconnect: true }),
      choice('Video codec', 'codec', 'codec', [['auto', 'Auto'], ['h264_high', 'H.264 High'], ['h264_main', 'H.264 Main'], ['h264_baseline', 'H.264 Baseline']], { sub: NEXT, reconnect: true }),
      choice('Max bitrate', 'max_bitrate', 'maxBitrate', [[0, 'Unlimited'], [40000, '40 Mbps'], [30000, '30 Mbps'], [20000, '20 Mbps'], [15000, '15 Mbps'], [10000, '10 Mbps'], [8000, '8 Mbps'], [5000, '5 Mbps'], [3000, '3 Mbps']], { sub: NEXT, reconnect: true }),
      choice('Server region', 'region', 'region', regionOpts(), { sub: NEXT, reconnect: true }),
      { header: 'Picture (changes instantly)' },
      choice('Screen fit', 'video_fit', 'videoFit', [['contain', 'Fit'], ['cover', 'Zoom to fill'], ['fill', 'Stretch']], { live: function () { applyVideoStyle(); } }),
      stepper('Sharpness', 'sharpness', 'sharpness', 0, 10, 1, '', { fmt: function (v) { return v ? String(v) : 'Off'; }, live: livePicture }),
      choice('Sharpen style', 'clarity_algo', 'clarityAlgo', [['sharpen', 'Crisp'], ['unsharp', 'Natural']], { live: livePicture }),
      stepper('Saturation', 'saturation', 'saturation', 50, 150, 5, '%', { def: 100, live: livePicture }),
      stepper('Contrast', 'contrast', 'contrast', 50, 150, 5, '%', { def: 100, live: livePicture }),
      stepper('Brightness', 'brightness', 'brightness', 50, 150, 5, '%', { def: 100, live: livePicture }),
      { header: 'Audio' },
      stepper('Game volume', 'volume', 'volume', 50, 300, 25, '%', { def: 100, live: function () { applyVolume(); } }),
      { header: 'Controller' },
      choice('Button layout', 'button_layout', 'buttonLayout', [['xbox', 'Xbox'], ['nintendo', 'Swap A/B and X/Y']], { sub: 'For handhelds with Nintendo-style button labels' }),
      stepper('Stick deadzone', 'deadzone', 'deadzone', 0, 30, 2, '%', { def: 5 }),
      toggle('Invert right stick Y', 'invert_y', 'invertY'),
      choice('Rumble', 'rumble', 'rumble', [['auto', 'Controller, else phone'], ['controller', 'Controller only'], ['phone', 'Phone only'], ['off', 'Off']], { sub: 'Applies after reload' }),
      stepper('Rumble strength', 'rumble_strength', 'rumbleStrength', 10, 100, 10, '%', { def: 100 }),
      { header: 'Touch controls' },
      choice('On-screen buttons', 'touch_mode', 'touchMode', [['auto', 'When no controller'], ['always', 'Always'], ['off', 'Off']], { sub: 'Applies after reload' }),
      stepper('Opacity', 'touch_opacity', 'touchOpacity', 10, 100, 10, '%', { def: 60 }),
      stepper('Size', 'touch_size', 'touchSize', 50, 150, 10, '%', { def: 100 }),
      { label: 'Edit touch layout', go: function () { close(); window.__cpTouch && __cpTouch.edit(); } },
      { header: 'Overlay & performance' },
      toggle('Stream stats', 'show_stats', 'showStats'),
      toggle('Zero-buffer mode', 'low_latency', 'lowLatency', { sub: 'Quicker response, but glitches if packets drop' }),
      toggle('Keep running in background', 'keep_alive', 'keepAlive'),
      toggle('Sound in background', 'bg_audio', 'bgAudio'),
      toggle('Faster page loading', 'fast_art', 'fastArt'),
      { header: 'Remote Play' },
      choice('Connection', 'remote_play_mode', 'remotePlayMode', [['auto', 'Auto (fastest)'], ['standard', 'Standard']], { sub: NEXT, reconnect: true }),
      choice('Sharpening', 'rp_sharpen', 'rpSharpen', [['medium', 'Medium'], ['high', 'High'], ['low', 'Low'], ['off', 'Off']],
        { sub: 'Graphics-chip sharpening for a crisper picture than the website', live: function () { applyVideoStyle(); } }),
      choice('Resolution', 'rp_resolution', 'rpResolution', [['auto', 'Auto (1080p)'], ['720p', '720p'], ['1080p', '1080p'], ['1080p_hq', '1080p HQ']], { sub: NEXT, reconnect: true })
    ];
  }

  function clarityItems() {
    return CLARITY.map(function (c) {
      return { label: c[1], check: (C.clarityPreset || 'off') === c[0], go: function () {
        C.clarityPreset = c[0];
        try { native() && native().setClarity(c[0]); } catch (e) {}
        if (bxOn()) toast('Clarity boost applies when the next game starts');
        render('clarity', focusIdx);
      } };
    });
  }

  function injectMenuStyle() {
    if (document.getElementById('cpm-style')) return;
    var st = document.createElement('style');
    st.id = 'cpm-style';
    st.textContent =
      '.cpm-backdrop{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,.35);font-family:inherit;-webkit-font-smoothing:antialiased;animation:cpmFade .15s ease-out}' +
      '.cpm{width:min(92vw,1180px);height:min(88vh,680px);box-sizing:border-box;padding:3.2vh 3.4vw;color:#fff;' +
      'background:rgba(52,55,82,.78);-webkit-backdrop-filter:blur(28px) saturate(150%);backdrop-filter:blur(28px) saturate(150%);' +
      'border-radius:6px;box-shadow:0 24px 80px rgba(0,0,0,.45);display:flex;flex-direction:column;animation:cpmPop .18s ease-out}' +
      '.cpm-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:2.6vh}' +
      '.cpm-title{font-size:22px;font-weight:600;letter-spacing:.2px;display:flex;align-items:center;gap:14px}' +
      '.cpm-back,.cpm-close{background:none;border:0;color:#fff;padding:8px;border-radius:50%;cursor:pointer;display:flex}' +
      '.cpm-back:hover,.cpm-close:hover{background:rgba(255,255,255,.12)}' +
      '.cpm-list{overflow-y:auto;display:flex;flex-direction:column;gap:4px;padding:2px;scrollbar-width:none}' +
      '.cpm-row{display:flex;align-items:center;gap:16px;min-height:48px;padding:8px 18px;border-radius:6px;cursor:pointer;' +
      'font-size:16px;font-weight:500;transition:background .12s}' +
      '.cpm-row .cpm-txt{display:flex;flex-direction:column;gap:2px}' +
      '.cpm-row .cpm-sub{font-size:12.5px;font-weight:400;color:rgba(255,255,255,.68)}' +
      '.cpm-row .cpm-detail{margin-left:auto;font-size:14px;font-weight:400;color:rgba(255,255,255,.75)}' +
      '.cpm-row .cpm-end{margin-left:auto;display:flex;align-items:center;opacity:.9}' +
      '.cpm-row .cpm-detail + .cpm-end{margin-left:10px}' +
      '.cpm-row.cpm-focus,.cpm-row:hover{background:rgba(196,200,255,.30)}' +
      '.cpm-row.cpm-focus{box-shadow:0 0 0 2px rgba(255,255,255,.85) inset}' +
      '.cpm-section{font-size:12px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:rgba(214,217,255,.75);margin:14px 6px 4px}' +
      '.cpm-adjust{margin-left:auto;display:flex;align-items:center;gap:10px;font-size:14px}' +
      '.cpm-val{min-width:120px;text-align:center;color:#fff}' +
      '.cpm-arrow{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(255,255,255,.10);font-size:20px;line-height:1;cursor:pointer}' +
      '.cpm-row.cpm-focus .cpm-arrow{background:rgba(255,255,255,.22)}' +
      '.cpm-hint{margin-top:auto;padding-top:2vh;font-size:12.5px;color:rgba(255,255,255,.55)}' +
      '.cp-toast{position:fixed;left:50%;bottom:8vh;transform:translateX(-50%);z-index:2147483647;background:rgba(30,30,30,.92);' +
      'color:#fff;padding:10px 18px;border-radius:6px;font:14px system-ui,sans-serif}' +
      '@keyframes cpmFade{from{opacity:0}to{opacity:1}}@keyframes cpmPop{from{transform:scale(.98);opacity:.6}to{transform:none;opacity:1}}';
    document.head.appendChild(st);
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'cp-toast'; t.textContent = msg;
    document.documentElement.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  function setFocus(i) {
    if (!rows.length) return;
    focusIdx = (i + rows.length) % rows.length;
    rows.forEach(function (r, k) { r.classList.toggle('cpm-focus', k === focusIdx); });
    rows[focusIdx].scrollIntoView({ block: 'nearest' });
  }

  function render(which, keepFocus) {
    page = which;
    var box = menuEl.querySelector('.cpm');
    box.innerHTML = '';
    var head = document.createElement('div'); head.className = 'cpm-head';
    var title = document.createElement('div'); title.className = 'cpm-title';
    if (which === 'clarity' || which === 'advanced') {
      var back = document.createElement('button'); back.className = 'cpm-back'; back.setAttribute('aria-label', 'Back');
      back.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      back.onclick = function () { render(rootPage); };
      title.appendChild(back);
    }
    title.appendChild(document.createTextNode(
      which === 'main' ? 'Settings' : which === 'remote' ? 'Remote Play settings' :
      which === 'advanced' ? 'Advanced settings' : 'Clarity boost'));
    var x = document.createElement('button'); x.className = 'cpm-close'; x.setAttribute('aria-label', 'Close');
    x.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    x.onclick = close;
    head.appendChild(title); head.appendChild(x); box.appendChild(head);

    var list = document.createElement('div'); list.className = 'cpm-list';
    var items = which === 'main' ? mainItems() : which === 'remote' ? remoteItems() :
      which === 'advanced' ? advancedItems() : clarityItems();
    rows = [];
    items.forEach(function (it) {
      if (it.header) {
        var h = document.createElement('div'); h.className = 'cpm-section'; h.textContent = it.header;
        list.appendChild(h);
        return;
      }
      var k = rows.length;
      var r = document.createElement('div'); r.className = 'cpm-row';
      var txt = document.createElement('div'); txt.className = 'cpm-txt';
      var l = document.createElement('div'); l.textContent = it.label; txt.appendChild(l);
      if (it.sub) { var sb = document.createElement('div'); sb.className = 'cpm-sub'; sb.textContent = it.sub; txt.appendChild(sb); }
      r.appendChild(txt);
      if (it.adjustable) {
        var adj = document.createElement('div'); adj.className = 'cpm-adjust';
        var lb = document.createElement('span'); lb.className = 'cpm-arrow'; lb.textContent = '\u2039';
        var val = document.createElement('span'); val.className = 'cpm-val'; val.textContent = it.detail;
        var rb = document.createElement('span'); rb.className = 'cpm-arrow'; rb.textContent = '\u203A';
        lb.addEventListener('click', function (e) { e.stopPropagation(); setFocus(k); doAdjust(-1); });
        rb.addEventListener('click', function (e) { e.stopPropagation(); setFocus(k); doAdjust(1); });
        adj.appendChild(lb); adj.appendChild(val); adj.appendChild(rb);
        r.appendChild(adj);
        r._adjust = it.adjust;
        r._go = function () { doAdjust(1); };
      } else {
        if (it.detail) { var d = document.createElement('div'); d.className = 'cpm-detail'; d.textContent = it.detail; r.appendChild(d); }
        var end = document.createElement('div'); end.className = 'cpm-end';
        end.innerHTML = it.check ? CHECK : (it.check === false ? '' : CHEVRON);
        r.appendChild(end);
        r._go = it.go;
      }
      r.addEventListener('click', function (e) { e.stopPropagation(); r._go(); });
      r.addEventListener('mouseenter', function () { setFocus(k); });
      if (it.check) r._checked = true;
      list.appendChild(r);
      rows.push(r);
    });
    box.appendChild(list);
    var hint = document.createElement('div'); hint.className = 'cpm-hint';
     hint.textContent = (which === 'advanced' ? '\u25C0\u25B6 Change    ' : '') +
      (which === rootPage ? '\u24B6 Select    \u24B7 Close' : '\u24B6 Select    \u24B7 Back');
    box.appendChild(hint);
    var checked = rows.findIndex(function (r) { return r._checked; });
    setFocus(keepFocus != null ? keepFocus : Math.max(0, checked));
  }

  function goBackOrClose() { if (page !== rootPage) render(rootPage); else close(); }

  function doAdjust(d) {
    var r = rows[focusIdx];
    if (!r || !r._adjust) return;
    var scroll = menuEl.querySelector('.cpm-list').scrollTop;
    r._adjust(d);
    render(page, focusIdx);
    menuEl.querySelector('.cpm-list').scrollTop = scroll;
  }

  // Controller navigation for the panel (D-pad / left stick, A, B), with key repeat.
  function startPadNav() {
    var prev = {}, holdDir = 0, nextRepeat = 0;
    padTimer = setInterval(function () {
      var pads = rawPads(), b = {}, dir = 0;
      pads.forEach(function (p) {
        if (!p || !p.buttons) return;
        [0, 1, 12, 13, 14, 15].forEach(function (i) { if (p.buttons[i] && p.buttons[i].pressed) b[i] = true; });
        var ax = p.axes && p.axes[0] || 0, ay = p.axes && p.axes[1] || 0;
        if (ay < -0.6) b[12] = true; if (ay > 0.6) b[13] = true;
        if (ax < -0.6) b[14] = true; if (ax > 0.6) b[15] = true;
      });
      // up/down = move (-1/+1), left/right = change value (-2/+2)
      if (b[12]) dir = -1; else if (b[13]) dir = 1; else if (b[14]) dir = -2; else if (b[15]) dir = 2;
      var now = performance.now();
      if (dir && (dir !== holdDir || now >= nextRepeat)) {
        nextRepeat = now + (dir !== holdDir ? 380 : 120);
        if (Math.abs(dir) === 1) setFocus(focusIdx + dir); else doAdjust(dir / 2);
      }
      holdDir = dir;
      if (b[0] && !prev[0] && rows[focusIdx]) rows[focusIdx]._go();
      if (b[1] && !prev[1]) goBackOrClose();
      prev = b;
    }, 16);
  }

  function onKey(e) {
    if (!menuEl) return;
    var k = e.key;
    if (k === 'ArrowDown') setFocus(focusIdx + 1);
    else if (k === 'ArrowUp') setFocus(focusIdx - 1);
    else if (k === 'ArrowLeft') doAdjust(-1);
    else if (k === 'ArrowRight') doAdjust(1);
    else if (k === 'Enter' || k === ' ') { if (rows[focusIdx]) rows[focusIdx]._go(); }
    else if (k === 'Escape' || k === 'Backspace') goBackOrClose();
    else return;
    e.preventDefault(); e.stopPropagation();
  }

  function open() {
    if (menuEl) return;
    injectMenuStyle();
    menuOpen = true;
    menuEl = document.createElement('div'); menuEl.className = 'cpm-backdrop';
    var font = document.body ? getComputedStyle(document.body).fontFamily : '';
    menuEl.style.fontFamily = (font && !/^(serif|"?Times)/i.test(font) ? font + ',' : '') +
      '"Segoe UI","Segoe UI Variable",Roboto,system-ui,sans-serif';
    var box = document.createElement('div'); box.className = 'cpm';
    box.addEventListener('click', function (e) { e.stopPropagation(); });
    menuEl.appendChild(box);
    menuEl.addEventListener('click', close);
    document.documentElement.appendChild(menuEl);
    window.addEventListener('keydown', onKey, true);
    rootPage = PURE_RP ? 'remote' : 'main';
    render(rootPage);
    // Ignore the button press that opened the panel.
    setTimeout(startPadNav, 250);
  }

  function close() {
    if (!menuEl) return;
    if (pendingReconnect) {
      pendingReconnect = false;
      toast('Applying your settings\u2026');
      setTimeout(function () { location.reload(); }, 450); // gives the app time to save them
    }
    clearInterval(padTimer); padTimer = null;
    window.removeEventListener('keydown', onKey, true);
    menuEl.remove(); menuEl = null; rows = [];
    setTimeout(function () { menuOpen = false; }, 200); // let the B press finish first
  }

  window.__cpMenu = { open: open, close: close, toggle: function () { menuEl ? close() : openSettingsUi(); } };

  // App options at the top of the Settings dialog, so there is one Settings everywhere
  // (header gear, in-game gear, View/Back). Styled with the dialog's own button classes.
  function closeBxDialog() {
    var t = document.activeElement || document.body;
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }

  function clarityName(v) {
    return (CLARITY.filter(function (c) { return c[0] === v; })[0] || CLARITY[0])[1];
  }

  function bxButton(label, onClick) {
    var b = document.createElement('button');
    b.className = 'bx-button bx-full-width bx-focusable cp-app-btn';
    b.tabIndex = 0;
    var span = document.createElement('span');
    span.textContent = label;
    b.appendChild(span);
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      onClick(span);
    });
    return b;
  }

  if (BX) onReady(function () {
    var st = document.createElement('style');
    st.textContent = '.cp-app-section{display:flex;flex-direction:column;gap:8px;margin-bottom:10px}' +
      '.cp-app-section .cp-app-title{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;' +
      'opacity:.7;margin:4px 2px 2px}';
    document.head.appendChild(st);

    setInterval(function () {
      var top = document.querySelector('.bx-top-buttons');
      if (!top || top.querySelector('.cp-app-section')) return;
      var ad = top.querySelector('a[href*="better-xcloud.github.io/android"]');
      if (ad) ad.remove();

      var sec = document.createElement('div');
      sec.className = 'cp-app-section';
      var title = document.createElement('div');
      title.className = 'cp-app-title';
      title.textContent = 'App';
      sec.appendChild(title);
      sec.appendChild(bxButton('App settings', function () {
        closeBxDialog(); native() && native().openSettings();
      }));
      sec.appendChild(bxButton('Remote Play', function () {
        closeBxDialog(); location.href = remotePlayUrl();
      }));
      sec.appendChild(bxButton('Clarity boost: ' + clarityName(C.clarityPreset || 'off'), function (span) {
        var idx = CLARITY.findIndex(function (c) { return c[0] === (C.clarityPreset || 'off'); });
        var next = CLARITY[(idx + 1) % CLARITY.length][0];
        C.clarityPreset = next;
        try { native() && native().setClarity(next); } catch (e) {}
        span.textContent = 'Clarity boost: ' + clarityName(next);
        if (bxOn()) toast('Clarity boost applies when the next game starts');
      }));
      sec.appendChild(bxButton('Show / hide touch controls', function () {
        closeBxDialog(); window.__cpTouch && __cpTouch.toggle();
      }));
      sec.appendChild(bxButton('Edit touch layout', function () {
        closeBxDialog(); setTimeout(function () { window.__cpTouch && __cpTouch.edit(); }, 150);
      }));
      sec.appendChild(bxButton('Exit app', function () { native() && native().exitApp(); }));
      top.insertBefore(sec, top.firstChild);
    }, 300);
  });

  // One entry point for "open settings": the Settings dialog when available, else the panel.
  function openSettingsUi() { window.__cpMenu.open(); }

  // ============================================================== volume
  var boost = { ctx: null, gain: null, el: null };
  function streamMediaEl() {
    var els = document.querySelectorAll('video, audio');
    for (var i = 0; i < els.length; i++) {
      var so = els[i].srcObject;
      if (so && so.getAudioTracks && so.getAudioTracks().length) return els[i];
    }
    return null;
  }
  function applyVolume() {
    var v = Math.max(0.5, Math.min(3, (parseInt(C.volume, 10) || 100) / 100));
    var el = streamMediaEl();
    if (!el) return;
    if (v <= 1 && !boost.ctx) { el.volume = v; return; }
    try {
      if (!boost.ctx || boost.el !== el) {
        if (boost.ctx) { try { boost.ctx.close(); } catch (e) {} }
        var ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
        var src = ctx.createMediaStreamSource(el.srcObject);
        var gain = ctx.createGain();
        src.connect(gain); gain.connect(ctx.destination);
        el.muted = true; // the boosted copy plays instead
        boost = { ctx: ctx, gain: gain, el: el };
      }
      boost.gain.gain.value = v;
      if (boost.ctx.state === 'suspended' && !bgAway) boost.ctx.resume();
    } catch (e) { el.volume = Math.min(1, v); }
  }
  setInterval(function () { if (lastStreaming && (parseInt(C.volume, 10) || 100) !== 100) applyVolume(); }, 1500);

  // ======================================================== in-game gear
  // A small frosted gear during games, shown whenever no gear in the stream bar is visible
  // (the bar folds up, and Xbox changes its design), so settings are always one tap away.
  var floatGear = null;
  // Any gear already in the game's bar? (Checked by presence: the copied wrapper can report
  // zero size even while its icon shows.) The floating gear is only a backup for when there's none.
  // Is this gear really on screen? Measured on its icon (wrappers can report zero size) and
  // confirmed by what's actually at that spot, so hidden or clipped copies don't count.
  function reallyVisible(el) {
    var icon = el.querySelector('svg') || el;
    var r = icon.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return false;
    var x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
    var y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    var hit = document.elementFromPoint(x, y);
    return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
  }
  function gearVisibleInHud() {
    var gs = document.querySelectorAll('.cp-hud-gear, .cp-bar-gear, #StreamHud button[title="Settings"]');
    for (var i = 0; i < gs.length; i++) if (reallyVisible(gs[i])) return true;
    return false;
  }

  // Xbox's newer in-game bar (Xbox logo + dots) isn't the old "StreamHud", so find it by
  // shape: a small fixed group of icon-only buttons. The gear is cloned from the bar's own
  // button so it looks native, and placed just before the dots.
  function isOurs(el) { return !!el.closest('.cp-float-gear, .cpm-backdrop, .cp-touch, .cp-bar-gear, .cp-hud-gear, header, [role="banner"]'); }
  function iconButtons() {
    var out = [];
    document.querySelectorAll('button').forEach(function (b) {
      if (isOurs(b) || !b.querySelector('svg') || b.querySelector('img')) return;
      if ((b.textContent || '').trim().length > 2) return;
      var r = b.getBoundingClientRect();
      if (r.width < 16 || r.width > 96 || r.height < 16 || r.height > 96) return;
      out.push(b);
    });
    return out;
  }
  function inFixedLayer(el) {
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      var pos = getComputedStyle(n).position;
      if (pos === 'fixed' || pos === 'absolute') return true;
    }
    return false;
  }
  function findStreamBar() {
    var btns = iconButtons(), best = null;
    btns.forEach(function (b) {
      // smallest ancestor (up to 4 levels) that holds 2-6 of these buttons
      var n = b.parentElement;
      for (var depth = 0; n && depth < 4; depth++, n = n.parentElement) {
        var inside = btns.filter(function (x) { return n.contains(x); });
        if (inside.length >= 2) {
          if (inside.length <= 6) {
            var r = n.getBoundingClientRect();
            var area = r.width * r.height;
            if (r.width < innerWidth * 0.6 && inFixedLayer(n) && (!best || area < best.area)) {
              best = { row: n, area: area, buttons: inside };
            }
          }
          break;
        }
      }
    });
    return best;
  }
  // Taps on the engine's own in-game gear open the same purple panel (its settings are
  // listed there), so every gear leads to one place.
  window.addEventListener('click', function (e) {
    if (!e.isTrusted) return;
    var t = e.target && e.target.closest && e.target.closest('button[title="Settings"]');
    if (!t || t.classList.contains('cp-hud-btn') || t.closest('.cp-bar-gear, .bx-settings-dialog, .cpm-backdrop')) return;
    if (!t.closest('#StreamHud, [class*="StreamHud"], [class*="HUD"]')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    window.__cpMenu.open();
  }, true);

  function engineGearShowing() {
    var gs = document.querySelectorAll('button[title="Settings"]:not(.cp-hud-btn)');
    for (var i = 0; i < gs.length; i++) {
      if (!gs[i].closest('.cp-bar-gear, .bx-settings-dialog, .cpm-backdrop') && reallyVisible(gs[i])) return true;
    }
    return false;
  }

  function ensureBarGear() {
    if (engineGearShowing()) { // one gear is enough
      document.querySelectorAll('.cp-bar-gear').forEach(function (g) { g.remove(); });
      return;
    }
    if (menuOpen) return;
    var gears = document.querySelectorAll('.cp-bar-gear');
    for (var i = 0; i < gears.length; i++) if (reallyVisible(gears[i])) return; // one is showing
    var bar0 = findStreamBar();
    if (!bar0) return;
    // A gear already sitting in the visible bar (just clipped for a moment)? Keep it.
    for (var j = 0; j < gears.length; j++) if (gears[j].parentElement === bar0.row) return;
    if (findHud() && document.querySelector('.cp-hud-gear') && reallyVisible(document.querySelector('.cp-hud-gear'))) return;
    var bar = bar0;
    var row = bar.row;
    // the direct child of the row that holds each button ("unit": button or its wrapper)
    var units = bar.buttons.map(function (b) {
      var u = b; while (u.parentElement && u.parentElement !== row) u = u.parentElement;
      return u;
    });
    var first = units[0], last = units[units.length - 1];
    var g = cleanClone(first);
    g.classList.add('cp-bar-gear');
    var btn = g.tagName === 'BUTTON' ? g : (g.querySelector('button') || g);
    btn.setAttribute('aria-label', 'Settings');
    btn.setAttribute('title', 'Settings');
    var svg = g.querySelector('svg'); if (svg) svg.style.fill = 'none';
    g.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); window.__cpMenu.open();
    }, true);
    row.insertBefore(g, last);
  }
  onReady(function () { setInterval(function () { if (lastStreaming) ensureBarGear(); }, 700); });
  function ensureFloatGear() {
    var show = !!lastStreaming && !menuOpen && !gearVisibleInHud();
    if (!floatGear && show) {
      floatGear = document.createElement('button');
      floatGear.className = 'cp-float-gear';
      floatGear.setAttribute('aria-label', 'Settings');
      floatGear.appendChild(gearSvg(null));
      floatGear.style.cssText = 'position:fixed;left:12px;top:72px;z-index:2147483645;width:40px;height:40px;' +
        'border-radius:50%;border:1px solid rgba(255,255,255,.28);color:#fff;display:flex;align-items:center;' +
        'justify-content:center;padding:0;background:linear-gradient(135deg,rgba(58,61,94,.72),rgba(44,46,72,.66));' +
        '-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);opacity:.6;transition:opacity .15s;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.35)';
      floatGear.querySelector('svg').setAttribute('width', '22');
      floatGear.querySelector('svg').setAttribute('height', '22');
      floatGear.addEventListener('pointerdown', function () { floatGear.style.opacity = '1'; });
      floatGear.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation(); floatGear.style.opacity = '.6'; window.__cpMenu.open();
      }, true);
      document.documentElement.appendChild(floatGear);
    }
    if (floatGear) floatGear.style.display = show ? 'flex' : 'none';
  }
  // The floating gear is off: settings live only in the in-game bar (open it with the dots).
  // ensureFloatGear stays available but isn't scheduled.

  // ================================================================ latency
  // Ask WebRTC for the smallest playout buffer: lower input-to-photon delay.
  // Off by default: a zero buffer leaves no time for lost video packets to be re-sent, which
  // shows up as blocky glitches. The stream's own adaptive buffer is the smooth choice.
  if (true) {
    setInterval(async function () {
      if (C.lowLatency !== true) { // switched off: give receivers back their normal buffer once
        pcs.forEach(function (pc) {
          try { pc.getReceivers().forEach(function (r) { if ('jitterBufferTarget' in r && r.jitterBufferTarget === 0) r.jitterBufferTarget = null; }); } catch (e) {}
        });
        return;
      }
      // Remote Play: smallest buffer only on a direct home-network route; over the internet
      // the normal buffer keeps it smooth.
      var rp = location.pathname.indexOf('/play/consoles') >= 0;
      if (!rp && !ACTIVE) return;
      for (var i = 0; i < pcs.length; i++) {
        var pc = pcs[i];
        if (pc.connectionState === 'closed') continue;
        if (rp) {
          var route = await routeInfo(pc);
          if (!route || route.kind !== 'home') continue;
        }
        try {
          pc.getReceivers().forEach(function (r) {
            if ('jitterBufferTarget' in r) { if (r.jitterBufferTarget !== 0) r.jitterBufferTarget = 0; }
            else if ('playoutDelayHint' in r) { if (r.playoutDelayHint !== 0) r.playoutDelayHint = 0; }
          });
        } catch (e) {}
      }
    }, 1000);
  }

  // Which route the stream is using: home network (direct), internet (direct) or relay.
  function isPrivateIp(a) {
    return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fe80:|f[cd][0-9a-f]{2}:)/i.test(a || '');
  }
  async function routeInfo(pc) {
    try {
      var stats = await pc.getStats(), pair = null, byId = {};
      stats.forEach(function (r) {
        byId[r.id] = r;
        if (r.type === 'transport' && r.selectedCandidatePairId) pair = r.selectedCandidatePairId;
      });
      pair = pair ? byId[pair] : null;
      if (!pair) stats.forEach(function (r) { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
      if (!pair) return null;
      var rc = byId[pair.remoteCandidateId] || {}, lc = byId[pair.localCandidateId] || {};
      var addr = rc.address || rc.ip;
      var kind = rc.candidateType === 'relay' || lc.candidateType === 'relay' ? 'relay'
        : isPrivateIp(addr) ? 'home' : 'internet';
      return { kind: kind, address: addr };
    } catch (e) { return null; }
  }

  // ======================================================== touch overlay UI
  var DEFAULT_LAYOUT = {
    ls:   { x: 12, y: 66, s: 30 },
    dpad: { x: 29, y: 84, s: 22 },
    rs:   { x: 72, y: 82, s: 24 },
    abxy: { x: 88, y: 62, s: 32 },
    lt:   { x: 7,  y: 11, s: 10 },
    lb:   { x: 7,  y: 27, s: 10 },
    rt:   { x: 93, y: 11, s: 10 },
    rb:   { x: 93, y: 27, s: 10 },
    view: { x: 42, y: 9,  s: 8 },
    menu: { x: 58, y: 9,  s: 8 },
    l3:   { x: 25, y: 52, s: 8 },
    r3:   { x: 60, y: 70, s: 8 }
  };
  var BUTTONS = {
    lt: [6, 'LT'], lb: [4, 'LB'], rt: [7, 'RT'], rb: [5, 'RB'],
    view: [8, '⧉'], menu: [9, '≡'], l3: [10, 'LS'], r3: [11, 'RS']
  };

  function loadLayout() {
    var l = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
    try {
      var saved = C.touchLayout ? JSON.parse(C.touchLayout) : null;
      if (saved) Object.keys(l).forEach(function (k) { if (saved[k]) l[k] = saved[k]; });
    } catch (e) {}
    return l;
  }

  var layout = loadLayout();
  var root = null, els = {}, editing = false, forceShow = null, selected = null, toolbar = null;
  var scale = (C.touchSize || 100) / 100;

  function css(el, s) { el.style.cssText = s; return el; }
  function div(cls, text) {
    var d = document.createElement('div');
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  }

  function placeAll() {
    Object.keys(els).forEach(function (k) {
      var L = layout[k], el = els[k], size = L.s * scale;
      el.style.left = L.x + 'vw';
      el.style.top = L.y + 'vh';
      el.style.width = el.style.height = size + 'vh';
      el.style.fontSize = (size * 0.32) + 'vh';
      el.classList.toggle('cp-sel', editing && selected === k);
    });
  }

  function buildOverlay() {
    root = div('cp-touch');
    var st = document.createElement('style');
    st.textContent =
      '.cp-touch{position:fixed;inset:0;z-index:2147483646;pointer-events:none;touch-action:none;' +
      'user-select:none;-webkit-user-select:none;opacity:' + ((C.touchOpacity || 60) / 100) + ';display:none}' +
      '.cp-touch.cp-edit{opacity:1;background:rgba(0,0,0,.35)}' +
      '.cp-c{position:absolute;transform:translate(-50%,-50%);pointer-events:auto;touch-action:none;' +
      'font-family:system-ui,sans-serif;font-weight:700;color:#fff}' +
      '.cp-btn{border-radius:50%;border:2px solid rgba(255,255,255,.75);background:rgba(20,20,20,.45);' +
      'display:flex;align-items:center;justify-content:center}' +
      '.cp-btn.cp-on,.cp-face.cp-on{background:rgba(255,255,255,.55)}' +
      '.cp-stick{border-radius:50%;border:2px solid rgba(255,255,255,.6);background:rgba(20,20,20,.35)}' +
      '.cp-knob{position:absolute;left:50%;top:50%;width:44%;height:44%;margin:-22% 0 0 -22%;border-radius:50%;' +
      'background:rgba(255,255,255,.6)}' +
      '.cp-face{position:absolute;width:34%;height:34%;border-radius:50%;border:2px solid currentColor;' +
      'background:rgba(20,20,20,.45);display:flex;align-items:center;justify-content:center;transform:translate(-50%,-50%)}' +
      '.cp-dpad{background:none}' +
      '.cp-arm{position:absolute;background:rgba(20,20,20,.5);border:2px solid rgba(255,255,255,.7);border-radius:6px}' +
      '.cp-arm.cp-on{background:rgba(255,255,255,.55)}' +
      '.cp-sel{outline:3px dashed #16c60c;outline-offset:4px}' +
      '.cp-bar{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;gap:8px;' +
      'align-items:center;background:rgba(0,0,0,.85);color:#fff;padding:8px 12px;border-radius:10px;' +
      'font:14px system-ui,sans-serif;pointer-events:auto}' +
      '.cp-bar button{font:inherit;color:#fff;background:#107c10;border:0;border-radius:6px;padding:6px 12px}';
    root.appendChild(st);

    // Sticks
    ['ls', 'rs'].forEach(function (k) {
      var el = div('cp-c cp-stick'), knob = div('cp-knob');
      el.appendChild(knob);
      var ax = k === 'ls' ? 0 : 2;
      stickHandler(el, knob, ax);
      els[k] = el;
    });

    // D-pad: four arms
    var dp = div('cp-c cp-dpad'), arms = {};
    [['up', 12, 'left:33%;top:0;width:34%;height:40%'], ['down', 13, 'left:33%;bottom:0;width:34%;height:40%'],
     ['left', 14, 'left:0;top:33%;width:40%;height:34%'], ['right', 15, 'right:0;top:33%;width:40%;height:34%']]
      .forEach(function (a) { var arm = css(div('cp-arm'), a[2]); arm.dataset.i = a[1]; arms[a[1]] = arm; dp.appendChild(arm); });
    dpadHandler(dp, arms);
    els.dpad = dp;

    // Face buttons
    var face = div('cp-c');
    [['Y', 3, '50%', '17%', '#f5c400'], ['X', 2, '17%', '50%', '#2f8cff'],
     ['B', 1, '83%', '50%', '#ff4d4d'], ['A', 0, '50%', '83%', '#3ad03a']].forEach(function (f) {
      var b = css(div('cp-face', f[0]), 'left:' + f[2] + ';top:' + f[3] + ';color:' + f[4]);
      buttonHandler(b, f[1]);
      face.appendChild(b);
    });
    els.abxy = face;

    // Shoulders, triggers, View/Menu, stick clicks
    Object.keys(BUTTONS).forEach(function (k) {
      var b = div('cp-c cp-btn', BUTTONS[k][1]);
      buttonHandler(b, BUTTONS[k][0]);
      els[k] = b;
    });

    Object.keys(els).forEach(function (k) { els[k].dataset.key = k; editHandler(els[k], k); root.appendChild(els[k]); });
    document.documentElement.appendChild(root);
    placeAll();
  }

  function buttonHandler(el, idx) {
    el.addEventListener('pointerdown', function (e) {
      if (editing) return;
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
      press(idx, true); el.classList.add('cp-on');
    });
    var up = function (e) { if (editing) return; press(idx, false); el.classList.remove('cp-on'); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function stickHandler(el, knob, ax) {
    var id = null;
    function move(e) {
      var r = el.getBoundingClientRect(), rad = r.width / 2;
      var dx = (e.clientX - (r.left + rad)) / rad, dy = (e.clientY - (r.top + rad)) / rad;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len > 1) { dx /= len; dy /= len; }
      setAxis(ax, dx); setAxis(ax + 1, dy);
      knob.style.transform = 'translate(' + (dx * 70) + '%,' + (dy * 70) + '%)';
    }
    el.addEventListener('pointerdown', function (e) {
      if (editing) return;
      e.preventDefault(); e.stopPropagation();
      id = e.pointerId;
      try { el.setPointerCapture(id); } catch (x) {}
      move(e);
    });
    el.addEventListener('pointermove', function (e) { if (!editing && e.pointerId === id) move(e); });
    var up = function (e) {
      if (e.pointerId !== id) return;
      id = null; setAxis(ax, 0); setAxis(ax + 1, 0); knob.style.transform = '';
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function dpadHandler(el, arms) {
    var id = null;
    function set(dirs) {
      [12, 13, 14, 15].forEach(function (i) {
        var on = dirs.indexOf(i) >= 0;
        if (vpad.buttons[i].pressed !== on) press(i, on);
        arms[i].classList.toggle('cp-on', on);
      });
    }
    function move(e) {
      var r = el.getBoundingClientRect(), rad = r.width / 2;
      var dx = (e.clientX - (r.left + rad)) / rad, dy = (e.clientY - (r.top + rad)) / rad, t = 0.3, d = [];
      if (dy < -t) d.push(12); if (dy > t) d.push(13);
      if (dx < -t) d.push(14); if (dx > t) d.push(15);
      set(d);
    }
    el.addEventListener('pointerdown', function (e) {
      if (editing) return;
      e.preventDefault(); e.stopPropagation();
      id = e.pointerId;
      try { el.setPointerCapture(id); } catch (x) {}
      move(e);
    });
    el.addEventListener('pointermove', function (e) { if (!editing && e.pointerId === id) move(e); });
    var up = function (e) { if (e.pointerId === id) { id = null; set([]); } };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function editHandler(el, k) {
    var start = null;
    el.addEventListener('pointerdown', function (e) {
      if (!editing) return;
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
      selected = k;
      start = { px: e.clientX, py: e.clientY, x: layout[k].x, y: layout[k].y };
      placeAll();
    }, true);
    el.addEventListener('pointermove', function (e) {
      if (!editing || !start) return;
      layout[k].x = Math.max(0, Math.min(100, start.x + (e.clientX - start.px) * 100 / innerWidth));
      layout[k].y = Math.max(0, Math.min(100, start.y + (e.clientY - start.py) * 100 / innerHeight));
      placeAll();
    }, true);
    var up = function () { start = null; };
    el.addEventListener('pointerup', up, true);
    el.addEventListener('pointercancel', up, true);
  }

  function showToolbar() {
    toolbar = div('cp-bar');
    var label = div(null, 'Drag to move. Tap a control, then resize:');
    function btn(text, fn) {
      var b = document.createElement('button');
      b.textContent = text;
      b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
      toolbar.appendChild(b);
    }
    toolbar.appendChild(label);
    btn('−', function () { if (selected) { layout[selected].s = Math.max(4, layout[selected].s * 0.9); placeAll(); } });
    btn('+', function () { if (selected) { layout[selected].s = Math.min(60, layout[selected].s * 1.1); placeAll(); } });
    btn('Reset', function () { layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT)); placeAll(); });
    btn('Done', function () { window.__cpTouch.editDone(); });
    document.documentElement.appendChild(toolbar);
  }

  function computeVisible() {
    if (editing) return true;
    if (forceShow !== null) return forceShow && streaming();
    if (!touchOn || !streaming()) return false;
    if (C.touchMode === 'always') return true;
    return !realPadConnected();
  }

  function tick() {
    if (!root) {
      if (!(touchOn && streaming()) && forceShow === null && !editing) return;
      buildOverlay();
    }
    var vis = computeVisible();
    root.style.display = vis ? 'block' : 'none';
    var active = vis && !editing;
    if (active !== vpadActive) {
      vpadActive = active;
      if (!active) releaseAll();
      announce(active ? 'gamepadconnected' : 'gamepaddisconnected');
    }
  }

  // Opens Better xCloud's own settings dialog (via its header button).
  window.__cpOpenBx = function () {
    if (typeof window.__bxShowSettings === 'function') {
      try { window.__bxShowSettings(); return 'ok'; } catch (e) {}
    }
    var b = document.querySelector('.bx-header-settings-button');
    if (b) { b.click(); return 'ok'; }
    return 'missing';
  };

  window.__cpTouch = {
    toggle: function () { if (!root) buildOverlay(); forceShow = !computeVisible(); tick(); },
    edit: function () {
      if (!root) buildOverlay();
      editing = true; selected = null;
      root.classList.add('cp-edit');
      releaseAll();
      showToolbar();
      placeAll(); tick();
    },
    editDone: function () {
      editing = false; selected = null;
      root.classList.remove('cp-edit');
      if (toolbar) { toolbar.remove(); toolbar = null; }
      placeAll(); tick();
      try { native() && native().saveTouchLayout(JSON.stringify(layout)); } catch (e) {}
    }
  };

  onReady(function () { setInterval(tick, 400); });

  // ============================================================ stats panel
  if (true) {
    var el = null, prev = {};
    setInterval(async function () {
      var pc = pcs.filter(function (p) { return p.connectionState === 'connected'; }).pop();
      if (!pc || !C.showStats) { if (el) el.style.display = 'none'; prev = {}; return; }
      if (!el) {
        el = document.createElement('div');
        el.style.cssText = 'position:fixed;top:6px;left:6px;z-index:2147483647;background:rgba(0,0,0,.6);' +
          'color:#fff;font:12px/1.4 monospace;padding:4px 8px;border-radius:6px;pointer-events:none;white-space:pre';
        document.documentElement.appendChild(el);
      }
      var stats = await pc.getStats(), v = null, pair = null, codecs = {};
      stats.forEach(function (r) {
        if (r.type === 'inbound-rtp' && r.kind === 'video') v = r;
        if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r;
        if (r.type === 'codec') codecs[r.id] = r;
      });
      if (!v) return;
      var mbps = '-', loss = '-', dec = '-';
      if (prev.ts) {
        mbps = ((v.bytesReceived - prev.bytes) * 8 / ((v.timestamp - prev.ts) / 1000) / 1e6).toFixed(1);
        var lost = (v.packetsLost || 0) - prev.lost, got = v.packetsReceived - prev.recv;
        loss = lost + got > 0 ? (Math.max(lost, 0) * 100 / (lost + got)).toFixed(1) : '0.0';
        if (v.framesDecoded > prev.frames) {
          dec = ((v.totalDecodeTime - prev.decode) * 1000 / (v.framesDecoded - prev.frames)).toFixed(1);
        }
      }
      prev = { ts: v.timestamp, bytes: v.bytesReceived, lost: v.packetsLost || 0, recv: v.packetsReceived,
        frames: v.framesDecoded || 0, decode: v.totalDecodeTime || 0 };
      var codec = v.codecId && codecs[v.codecId] ? codecs[v.codecId].mimeType.replace('video/', '') : '';
      var ping = pair && pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) + ' ms' : '-';
      var route = location.pathname.indexOf('/play/consoles') >= 0 ? await routeInfo(pc) : null;
      el.textContent = (v.frameWidth || '?') + 'x' + (v.frameHeight || '?') + ' ' + codec + '  ' +
        Math.round(v.framesPerSecond || 0) + ' fps\n' +
        'Ping ' + ping + '  ' + mbps + ' Mbps  Loss ' + loss + '%  Decode ' + dec + ' ms' +
        (route ? '\nRoute: ' + ({ home: 'Home network (direct)', internet: 'Internet (direct)', relay: 'Xbox relay' })[route.kind] : '');
      el.style.display = 'block';
    }, 1000);
  }
})();
