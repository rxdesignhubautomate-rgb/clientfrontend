// Update generated markup without replacing unchanged nodes, editors or media.
function key(node) {
  if (node.nodeType !== 1) return null;
  const data = node.dataset;
  return data.messageRow ? `message:${data.messageRow}`
    : data.conversationId ? `chat:${data.conversationId}`
    : node.id ? `id:${node.id}`
    : data.protectedMedia ? `media:${node.tagName}:${data.protectedMedia}` : null;
}

export function patchNode(current, desired, options = {}) {
  const {preserveInputs = true} = options;
  if (options.skip?.(current)) return current;
  if (current.nodeType !== desired.nodeType || current.nodeName !== desired.nodeName || key(current) !== key(desired)) {
    current.replaceWith(desired);
    return desired;
  }
  if (current.nodeType !== 1) {
    if (current.nodeValue !== desired.nodeValue) current.nodeValue = desired.nodeValue;
    return current;
  }
  const focused = current === current.ownerDocument.activeElement;
  const field = /^(INPUT|TEXTAREA|SELECT)$/.test(current.tagName);
  const edited = field && (focused || current.type === 'file' ||
    ('defaultValue' in current && current.value !== current.defaultValue) ||
    (current.tagName === 'SELECT' && [...current.options].some(option => option.selected !== option.defaultSelected)));
  // A saved file's signed URL may rotate on every API response; its identity is stable.
  const sameMedia = current.dataset.protectedMedia && current.dataset.protectedMedia === desired.dataset.protectedMedia;
  const keep = name => (sameMedia && ['src','data-media-fallback'].includes(name)) ||
    (preserveInputs && edited && ['value','checked','selected'].includes(name)) ||
    (current.tagName === 'DETAILS' && name === 'open') ||
    (focused && current.tagName === 'BUTTON' && name === 'disabled' && current.disabled);
  for (const attr of [...current.attributes]) {
    if (!desired.hasAttribute(attr.name) && !keep(attr.name)) current.removeAttribute(attr.name);
  }
  for (const attr of [...desired.attributes]) {
    if (!keep(attr.name) && current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
  }
  if (!(preserveInputs && edited && ['TEXTAREA','SELECT'].includes(current.tagName))) patchChildren(current, desired, options);
  return current;
}

function patchChildren(parent, desired, options) {
  const keyed = new Map([...parent.childNodes].map(node => [key(node), node]).filter(([id]) => id));
  let cursor = parent.firstChild;
  for (const next of [...desired.childNodes]) {
    const id = key(next);
    const match = id ? keyed.get(id) : cursor && !key(cursor) && cursor.nodeName === next.nodeName ? cursor : null;
    if (match) {
      if (match !== cursor) parent.insertBefore(match, cursor);
      const retained = patchNode(match, next, options);
      cursor = retained.nextSibling;
      if (id) keyed.delete(id);
    } else {
      parent.insertBefore(next, cursor);
    }
  }
  while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next; }
}

export function patchMarkup(parent, markup, options) {
  const template = parent.ownerDocument.createElement('template');
  template.innerHTML = markup;
  patchChildren(parent, template.content, options);
}

// Binding can be repeated after a patch without multiplying event handlers.
export function bindLiveEvent(target, slot, type, handler, options) {
  if (!target) return;
  const bindings = target.__crmLiveBindings ||= new Map();
  const bindingKey = `${slot}:${type}`;
  const previous = bindings.get(bindingKey);
  if (previous) target.removeEventListener(previous.type, previous.handler, previous.options);
  target.addEventListener(type, handler, options);
  bindings.set(bindingKey, {type,handler,options});
}
