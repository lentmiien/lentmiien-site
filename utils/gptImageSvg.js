const { XMLParser, XMLValidator } = require('fast-xml-parser');

const MAX_SVG_BYTES = 2 * 1024 * 1024;
const TAGS = new Set(['svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask']);
const ATTRIBUTES = new Set(('xmlns id viewBox width height x y x1 y1 x2 y2 cx cy r rx ry dx dy d points transform fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity opacity clip-path clip-rule mask font-family font-size font-weight font-style text-anchor dominant-baseline letter-spacing word-spacing preserveAspectRatio gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity fx fy fr maskUnits maskContentUnits clipPathUnits').split(' '));

// Provider output is untrusted. Accept only passive vector content before either
// browser delivery or rasterization; no DTDs, CSS, links, use/image or animation.
function validateGeneratedSvg(buffer) {
  const invalid = () => { throw new Error('Unsupported generated SVG content.'); };
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_SVG_BYTES) invalid();
  const xml = buffer.toString('utf8');
  if (/<!DOCTYPE|<!ENTITY|<\?(?!xml\s)/i.test(xml) || XMLValidator.validate(xml) !== true) invalid();
  const nodes = new XMLParser({ ignoreAttributes: false, preserveOrder: true, processEntities: true }).parse(xml);
  let count = 0;
  function inspect(entries, depth = 0) {
    if (depth > 64) invalid();
    for (const entry of entries) {
      if (++count > 20000) invalid();
      for (const [tag, children] of Object.entries(entry)) {
        if (tag === ':@' || tag === '#text' || (tag === '?xml' && depth === 0)) continue;
        if (!TAGS.has(tag)) invalid();
        for (const [key, rawValue] of Object.entries(entry[':@'] || {})) {
          const name = key.slice(2);
          const value = String(rawValue);
          if (!ATTRIBUTES.has(name) || /[\x00-\x08\x0b\x0c\x0e-\x1f\\]/.test(value)) invalid();
          if (name === 'xmlns' && value !== 'http://www.w3.org/2000/svg') invalid();
          if (/url\s*\(/i.test(value) && !/^url\(#[a-zA-Z_][\w.-]*\)$/.test(value)) invalid();
        }
        inspect(children, depth + 1);
      }
    }
  }
  const roots = nodes.filter(entry => !Object.hasOwn(entry, '?xml') && !Object.hasOwn(entry, '#text'));
  if (roots.length !== 1 || !Object.hasOwn(roots[0], 'svg')) invalid();
  inspect(nodes);
  return buffer;
}

module.exports = { validateGeneratedSvg, MAX_SVG_BYTES };
