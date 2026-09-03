/**
 * FLIR — Forward Looking Infrared
 * Military-grade thermal imaging with White-Hot/Black-Hot modes,
 * coherent temporal noise, hot-spot bloom, temperature banding,
 * soft IR diffraction, and full HUD overlay rendered in GLSL.
 *
 * Exposed uniforms:
 *   sensitivity (0-1) — contrast/range of temperature mapping
 *   bloom (0-1)       — hot-spot bloom/bleed intensity
 *   mode (0-1)        — 0 = White-Hot, 1 = Black-Hot (step at 0.5)
 *   pixelation (1-6)  — sensor resolution pixelation grid size
 *   palette (0-1)     — 0 = monochrome FLIR, 1 = Ironbow "Predator" color ramp
 */
export const thermalShader = {
  name: 'thermal',
  uniforms: {
    sensitivity: { default: 0.75, min: 0, max: 1, label: 'Sensitivity' },
    bloom: { default: 0.65, min: 0, max: 1, label: 'Bloom' },
    mode: { default: 0.0, min: 0, max: 1, label: 'WHOT/BHOT' },
    pixelation: { default: 1.5, min: 1, max: 6, label: 'Pixelation' },
    palette: { default: 0.0, min: 0, max: 1, label: 'Ironbow' },
  },
  fragmentShader: /* glsl */ `
    uniform sampler2D colorTexture;
    uniform vec2 colorTextureDimensions;
    uniform float intensity;
    uniform float time;
    uniform float sensitivity;
    uniform float bloom;
    uniform float mode;
    uniform float pixelation;
    uniform float palette;
    in vec2 v_textureCoordinates;

    // ── Ironbow "Predator" thermal palette ────────────────
    // Maps a 0-1 temperature to the classic FLIR ironbow ramp:
    // black -> deep purple -> magenta -> red -> orange -> yellow -> white.
    vec3 ironbow(float t) {
      t = clamp(t, 0.0, 1.0);
      const vec3 c0 = vec3(0.0, 0.0, 0.0);     // cold
      const vec3 c1 = vec3(0.13, 0.0, 0.30);   // deep purple
      const vec3 c2 = vec3(0.49, 0.0, 0.45);   // magenta
      const vec3 c3 = vec3(0.86, 0.10, 0.18);  // red
      const vec3 c4 = vec3(1.0, 0.55, 0.0);    // orange
      const vec3 c5 = vec3(1.0, 0.91, 0.32);   // yellow
      const vec3 c6 = vec3(1.0, 1.0, 1.0);     // hot (white)
      float s = t * 6.0;
      if (s < 1.0) return mix(c0, c1, s);
      if (s < 2.0) return mix(c1, c2, s - 1.0);
      if (s < 3.0) return mix(c2, c3, s - 2.0);
      if (s < 4.0) return mix(c3, c4, s - 3.0);
      if (s < 5.0) return mix(c4, c5, s - 4.0);
      return mix(c5, c6, s - 5.0);
    }

    // ── Value noise (coherent, smooth, drifting) ──────────
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    float valueNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f); // smoothstep interpolation
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    // Fractal Brownian motion for layered coherent noise
    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      vec2 shift = vec2(100.0);
      for (int i = 0; i < 4; i++) {
        v += a * valueNoise(p);
        p = p * 2.0 + shift;
        a *= 0.5;
      }
      return v;
    }

    // ── 7-segment digit renderer ──────────────────────────
    float segment(vec2 p, int seg) {
      float s = 0.0;
      if (seg == 0) s = step(0.2, p.x) * step(p.x, 0.8) * step(0.85, p.y) * step(p.y, 1.0);
      if (seg == 1) s = step(0.7, p.x) * step(p.x, 0.9) * step(0.5, p.y) * step(p.y, 0.95);
      if (seg == 2) s = step(0.7, p.x) * step(p.x, 0.9) * step(0.05, p.y) * step(p.y, 0.5);
      if (seg == 3) s = step(0.2, p.x) * step(p.x, 0.8) * step(0.0, p.y) * step(p.y, 0.15);
      if (seg == 4) s = step(0.1, p.x) * step(p.x, 0.3) * step(0.05, p.y) * step(p.y, 0.5);
      if (seg == 5) s = step(0.1, p.x) * step(p.x, 0.3) * step(0.5, p.y) * step(p.y, 0.95);
      if (seg == 6) s = step(0.2, p.x) * step(p.x, 0.8) * step(0.42, p.y) * step(p.y, 0.58);
      return s;
    }

    float digit(vec2 p, int d) {
      int masks[10] = int[10](0x7E, 0x30, 0x6D, 0x79, 0x33, 0x5B, 0x5F, 0x70, 0x7F, 0x7B);
      int m = masks[d];
      float s = 0.0;
      for (int i = 0; i < 7; i++) {
        if ((m >> (6 - i) & 1) == 1) s += segment(p, i);
      }
      return clamp(s, 0.0, 1.0);
    }

    // Render a character (digit, '.', or one of the 'rEL' letters) at position.
    // The '°' glyph was REMOVED (CARTOGRAPHIE A1): the readout it terminated
    // is a relative scene index, not a temperature, so the degree sign was the
    // one mark on it that asserted a physical quantity.
    float renderChar(vec2 p, int ch) {
      if (ch == 10) { // '.' decimal point
        return smoothstep(0.15, 0.0, length(p - vec2(0.5, 0.08)));
      }
      // 7-segment letters for the dimensionless 'rEL' label.
      if (ch == 12) return clamp(segment(p, 4) + segment(p, 6), 0.0, 1.0);       // 'r'
      if (ch == 13) return clamp(segment(p, 0) + segment(p, 3) + segment(p, 4)
                                 + segment(p, 5) + segment(p, 6), 0.0, 1.0);      // 'E'
      if (ch == 14) return clamp(segment(p, 3) + segment(p, 4)
                                 + segment(p, 5), 0.0, 1.0);                      // 'L'
      if (ch >= 0 && ch <= 9) return digit(p, ch);
      return 0.0;
    }

    // ── Crosshair ─────────────────────────────────────────
    float crosshair(vec2 uv) {
      vec2 c = uv - 0.5;
      float h = smoothstep(0.0015, 0.0005, abs(c.y)) *
                step(0.015, abs(c.x)) * step(abs(c.x), 0.04);
      float v = smoothstep(0.0015, 0.0005, abs(c.x)) *
                step(0.015, abs(c.y)) * step(abs(c.y), 0.04);
      return clamp(h + v, 0.0, 1.0);
    }

    // ── Scale bar (right edge) ────────────────────────────
    float scaleBar(vec2 uv) {
      // Vertical bar on right edge
      float barX = step(0.94, uv.x) * step(uv.x, 0.955);
      float barY = step(0.15, uv.y) * step(uv.y, 0.85);
      return barX * barY;
    }

    void main() {
      vec2 uv = v_textureCoordinates;
      vec2 dims = colorTextureDimensions;
      vec2 texel = 1.0 / dims;
      vec2 hudUV = uv; // preserve original UV for HUD overlay

      // ── Circular vignette mask (FLIR optics field of view) ──
      vec2 centered = uv * 2.0 - 1.0;
      float aspect = dims.x / dims.y;
      centered.x *= aspect;
      float radius = length(centered);
      float lensMask = pow(1.0 - smoothstep(0.6, 1.05, radius), 0.7);
      // Tube brightness falloff (center brightest)
      float lensShading = 1.0 - radius * radius * 0.25;
      lensShading = max(lensShading, 0.0);

      // If outside lens, render black
      if (lensMask < 0.001) {
        out_FragColor = vec4(vec3(0.0), 1.0);
        return;
      }

      // ── Sensor resolution pixelation (authentic FLIR resolution limits) ──
      float pixSize = mix(1.0, pixelation, intensity);
      vec2 snappedUV = floor(uv * dims / pixSize) * pixSize / dims;
      uv = mix(uv, snappedUV, intensity);

      // ── Soft IR blur (thermal cameras have lower resolution / diffraction) ──
      vec3 blurred = vec3(0.0);
      float totalWeight = 0.0;
      for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
          float w = exp(-0.5 * float(x * x + y * y) / 2.0);
          blurred += texture(colorTexture, uv + vec2(float(x), float(y)) * texel * 1.5).rgb * w;
          totalWeight += w;
        }
      }
      blurred /= totalWeight;
      vec4 original = texture(colorTexture, uv);

      // Mix between sharp and blurred based on intensity
      vec3 src = mix(original.rgb, blurred, 0.6 * intensity);

      // ── Luminance → temperature mapping ─────────────────
      float luma = dot(src, vec3(0.299, 0.587, 0.114));

      // Sensitivity remaps the luminance range
      float sens = mix(0.25, 1.0, sensitivity);
      float temp = clamp((luma - (0.5 - sens * 0.5)) / sens, 0.0, 1.0);

      // ── Temperature banding (contour lines) ─────────────
      float bands = 12.0;
      float bandLine = abs(fract(temp * bands) - 0.5);
      float contour = smoothstep(0.04, 0.06, bandLine);
      temp *= mix(1.0, contour * 0.85 + 0.15, 0.3 * intensity);

      // ── White-Hot / Black-Hot mode ──────────────────────
      float isBlackHot = step(0.5, mode);
      float thermal = mix(temp, 1.0 - temp, isBlackHot);

      // Monochrome FLIR (white/black-hot) vs Ironbow "Predator" color ramp.
      // Ironbow maps TRUE temperature (cold->dark, hot->white) so the colors
      // read correctly regardless of the WHOT/BHOT toggle.
      vec3 mono = vec3(thermal);
      vec3 iron = ironbow(temp);
      vec3 thermalColor = mix(mono, iron, palette);

      // ── Hot-spot bloom/bleed ────────────────────────────
      // Sample a wider area for bloom on bright spots
      float bloomSample = 0.0;
      float bloomWeight = 0.0;
      for (int y = -4; y <= 4; y++) {
        for (int x = -4; x <= 4; x++) {
          vec2 offset = vec2(float(x), float(y)) * texel * 3.0;
          float sLuma = dot(texture(colorTexture, uv + offset).rgb, vec3(0.299, 0.587, 0.114));
          float sMapped = clamp((sLuma - (0.5 - sens * 0.5)) / sens, 0.0, 1.0);
          float sFinal = mix(sMapped, 1.0 - sMapped, isBlackHot);
          float w = exp(-0.5 * float(x * x + y * y) / 8.0);
          // Only bloom the "hot" pixels (bright in WHOT, dark values in BHOT...
          // but since we already inverted, just bloom high values)
          float hotness = smoothstep(0.6, 1.0, sFinal);
          bloomSample += hotness * w;
          bloomWeight += w;
        }
      }
      bloomSample /= bloomWeight;
      thermalColor += bloomSample * bloom * 0.8;

      // ── Coherent temporal noise (slowly drifting, cloud-like) ──
      vec2 noiseCoord = uv * 80.0 + vec2(time * 0.3, time * 0.2);
      float noise = fbm(noiseCoord);
      noise = (noise - 0.5) * 0.08 * intensity;
      thermalColor += noise;

      // ── Subtle motion blur feel (slight blur) ───────────
      // Already handled by the initial IR blur above

      // ── HUD Overlay ─────────────────────────────────────
      float hud = 0.0;

      // Top-left: "FLIR" label + mode indicator
      // Rendered as simple box presence markers (not full text rendering)
      // We'll use a simplified approach: render mode text near top-left
      vec2 labelArea = (hudUV - vec2(0.02, 0.92)) / vec2(0.08, 0.04);
      if (labelArea.x >= 0.0 && labelArea.x <= 1.0 && labelArea.y >= 0.0 && labelArea.y <= 1.0) {
        // Simple horizontal bar as "FLIR" label marker
        hud += step(0.1, labelArea.x) * step(labelArea.x, 0.9) *
               step(0.3, labelArea.y) * step(labelArea.y, 0.7) * 0.6;
      }

      // Mode indicator below label
      vec2 modeArea = (hudUV - vec2(0.02, 0.88)) / vec2(0.06, 0.03);
      if (modeArea.x >= 0.0 && modeArea.x <= 1.0 && modeArea.y >= 0.0 && modeArea.y <= 1.0) {
        hud += step(0.1, modeArea.x) * step(modeArea.x, 0.9) *
               step(0.2, modeArea.y) * step(modeArea.y, 0.8) * 0.4;
      }

      // Center crosshair
      hud += crosshair(hudUV) * 0.7;

      // Top-right: RELATIVE scene index, labelled 'rEL', derived from the
      // centre luminance of the composed frame.
      //
      // It used to read 20.0 + centerLuma * 30.0, rendered with one decimal
      // and a degree sign: a physical temperature in Celsius, invented from
      // the brightness of an orthophoto, printed in the same seven-segment
      // type as the frame counter. Nothing in this pipeline measures radiance
      // — there is no thermal band anywhere in the imagery — so no number here
      // can be a temperature. The code comment said "simulated"; the screen
      // did not (CARTOGRAPHIE A1). The digits stay, the claim goes: rEL 0.62
      // is exactly what the shader knows, a dimensionless 0-1 scene index.
      float centerLuma = dot(texture(colorTexture, vec2(0.5)).rgb, vec3(0.299, 0.587, 0.114));
      float relIndex = clamp(centerLuma, 0.0, 0.999);
      int relTenths = int(relIndex * 10.0);
      int relHundredths = int(fract(relIndex * 10.0) * 10.0);

      float tempHud = 0.0;
      vec2 charSize = vec2(0.018, 0.035);
      float spacing = 0.02;
      vec2 labelOrigin = vec2(0.812, 0.92);
      vec2 tempOrigin = vec2(0.884, 0.92);

      // 'rEL' - the unit, so the digits cannot be read as degrees.
      for (int i = 0; i < 3; i++) {
        vec2 lp = (hudUV - (labelOrigin + vec2(float(i) * spacing, 0.0))) / charSize;
        if (lp.x >= 0.0 && lp.x <= 1.0 && lp.y >= 0.0 && lp.y <= 1.0) {
          tempHud += renderChar(lp, 12 + i);
        }
      }
      // Leading '0' — the index is bounded to the half-open unit interval.
      vec2 d1p = (hudUV - tempOrigin) / charSize;
      if (d1p.x >= 0.0 && d1p.x <= 1.0 && d1p.y >= 0.0 && d1p.y <= 1.0) {
        tempHud += renderChar(d1p, 0);
      }
      // Decimal point
      vec2 dpp = (hudUV - (tempOrigin + vec2(spacing, 0.0))) / charSize;
      if (dpp.x >= 0.0 && dpp.x <= 1.0 && dpp.y >= 0.0 && dpp.y <= 1.0) {
        tempHud += renderChar(dpp, 10); // '.'
      }
      // Tenths
      vec2 d2p = (hudUV - (tempOrigin + vec2(spacing * 1.6, 0.0))) / charSize;
      if (d2p.x >= 0.0 && d2p.x <= 1.0 && d2p.y >= 0.0 && d2p.y <= 1.0) {
        tempHud += renderChar(d2p, relTenths);
      }
      // Hundredths
      vec2 d3p = (hudUV - (tempOrigin + vec2(spacing * 2.6, 0.0))) / charSize;
      if (d3p.x >= 0.0 && d3p.x <= 1.0 && d3p.y >= 0.0 && d3p.y <= 1.0) {
        tempHud += renderChar(d3p, relHundredths);
      }
      hud += tempHud * 0.8;

      // Bottom-right: frame counter
      int frame = int(mod(time * 30.0, 10000.0));
      float framHud = 0.0;
      vec2 fOrigin = vec2(0.88, 0.04);
      for (int i = 0; i < 4; i++) {
        int dv = (frame / int(pow(10.0, float(3 - i)))) % 10;
        vec2 fp = (hudUV - (fOrigin + vec2(float(i) * spacing, 0.0))) / charSize;
        if (fp.x >= 0.0 && fp.x <= 1.0 && fp.y >= 0.0 && fp.y <= 1.0) {
          framHud += renderChar(fp, dv);
        }
      }
      hud += framHud * 0.5;

      // Scale bar (right edge gradient) — the ONLY legend this shader draws,
      // so it has to be the key to the image beside it. It was painted in
      // greyscale unconditionally, which meant that under the ironbow palette
      // the picture ran black-purple-magenta-red-orange-white while its own
      // key ran black-to-white: the key stopped decoding the map
      // (CARTOGRAPHIE, the swatch IS the datum). It now follows the same
      // mix(mono, iron, palette) the image does, from the same ironbow().
      float bar = scaleBar(hudUV);
      if (bar > 0.0) {
        float barGrad = (hudUV.y - 0.15) / 0.7; // 0 at bottom, 1 at top
        float barVal = mix(barGrad, 1.0 - barGrad, isBlackHot);
        // The ironbow ramp maps TRUE temperature regardless of WHOT/BHOT, so
        // the coloured key reads bottom-cold to top-hot in both modes — same
        // convention as the image (see the mono/iron mix above).
        vec3 barColor = mix(vec3(barVal), ironbow(barGrad), palette);
        thermalColor = mix(thermalColor, barColor, bar * 0.9);
      }

      // Composite HUD (rendered in white, slightly transparent)
      float hudBright = mix(1.0, 0.0, isBlackHot); // HUD is white in WHOT, dark in BHOT inverted
      // Actually, HUD should always be visible — use contrast
      thermalColor += hud * 0.6 * intensity;

      // ── Lens shading + vignette ───────────────────
      thermalColor *= lensShading;
      thermalColor *= lensMask;

      // Clamp final
      thermalColor = clamp(thermalColor, 0.0, 1.0);

      // Blend with original based on intensity, then fade to black at lens edges
      vec3 finalColor = mix(original.rgb, thermalColor, intensity);
      finalColor *= mix(1.0, lensMask, intensity);

      out_FragColor = vec4(finalColor, 1.0);
    }
  `,
};
