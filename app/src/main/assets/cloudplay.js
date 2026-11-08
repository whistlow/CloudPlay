// CloudPlay page script. Runs at document start on xbox.com and applies the app's settings.
// window.__CP_CFG is prepended by the app.
(function () {
  if (window.__cpInstalled) return;
  if (!/(^|\.)xbox\.com$/.test(location.hostname)) return;
  window.__cpInstalled = true;

  var C = window.__CP_CFG || {};
  var OS_NAMES = { '720p': 'android', '1080p': 'windows', '1080p_hq': 'tizen' };
  var H264_PROFILES = { h264_high: '64', h264_main: '4d', h264_baseline: '42' };

  function native() { return window.CloudPlayNative; }

  // ------------------------------------------------------------------ fetch
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

  window.fetch = async function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var path = url.split('?')[0];

    // Stream resolution: the server picks quality from the client's reported OS.
    if (/\/sessions\/(cloud|home)\/play$/.test(path) && OS_NAMES[C.resolution]) {
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
          if (C.region && C.region !== 'auto' && regions.some(function (x) { return x.name === C.region; })) {
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

  // ----------------------------------------------------------------- WebRTC
  var pcs = [];
  var PC = window.RTCPeerConnection;

  function applyCodec(pc) {
    var want = H264_PROFILES[C.codec];
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
      if (pcs.indexOf(this) < 0) pcs.push(this);
      try { applyCodec(this); } catch (e) {}
      var offer = await origCreateOffer.apply(this, arguments);
      try {
        if (offer && offer.sdp) offer = { type: offer.type, sdp: limitBitrate(offer.sdp) };
      } catch (e) {}
      return offer;
    };
  }

  // ------------------------------------------------------------ video style
  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(function () {
    var filters = [];
    var sharp = parseInt(C.sharpness, 10) || 0;
    if (sharp > 0) {
      var k = (sharp * 0.06).toFixed(3), c = (1 + 4 * sharp * 0.06).toFixed(3);
      var holder = document.createElement('div');
      holder.innerHTML = '<svg width="0" height="0" style="position:absolute"><filter id="cp-sharpen">' +
        '<feConvolveMatrix order="3" preserveAlpha="true" kernelMatrix="0 -' + k + ' 0 -' + k + ' ' + c + ' -' + k + ' 0 -' + k + ' 0"/>' +
        '</filter></svg>';
      document.body.appendChild(holder.firstChild);
      filters.push('url(#cp-sharpen)');
    }
    if (C.saturation && C.saturation !== 100) filters.push('saturate(' + C.saturation / 100 + ')');
    if (C.contrast && C.contrast !== 100) filters.push('contrast(' + C.contrast / 100 + ')');
    if (C.brightness && C.brightness !== 100) filters.push('brightness(' + C.brightness / 100 + ')');

    var css = 'video{object-fit:' + (C.videoFit || 'contain') + ' !important;' +
      (filters.length ? 'filter:' + filters.join(' ') + ' !important;' : '') + '}' +
      'html,body{overscroll-behavior:none;}';
    var style = document.createElement('style');
    style.id = 'cp-style';
    style.textContent = css;
    document.head.appendChild(style);
  });

  // ------------------------------------------------------------ stats panel
  if (C.showStats) {
    var el = null, prev = {};
    setInterval(async function () {
      var pc = pcs.filter(function (p) { return p.connectionState === 'connected'; }).pop();
      if (!pc) { if (el) el.style.display = 'none'; prev = {}; return; }
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
      el.textContent = (v.frameWidth || '?') + 'x' + (v.frameHeight || '?') + ' ' + codec + '  ' +
        Math.round(v.framesPerSecond || 0) + ' fps\n' +
        'Ping ' + ping + '  ' + mbps + ' Mbps  Loss ' + loss + '%  Decode ' + dec + ' ms';
      el.style.display = 'block';
    }, 1000);
  }
})();
