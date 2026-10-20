// Native ESM schema validation; no executable strings or vendor-specific coercion.
export function validateSchema(schema, value, location = 'input') {
  const errors = [];
  const fail = (message) => errors.push(`${location}: ${message}`);
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return [`${location}: se requiere un objeto`];
    for (const name of schema.required || []) if (!Object.hasOwn(value, name)) fail(`falta ${name}`);
    for (const [name, child] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties || {}, name)) errors.push(...validateSchema(schema.properties[name], child, `${location}.${name}`));
      else if (schema.additionalProperties === false) fail(`campo desconocido ${name}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${location}: se requiere una lista`];
    if (value.length < (schema.minItems || 0) || value.length > (schema.maxItems ?? Infinity)) fail('cantidad fuera del límite');
    value.forEach((item, index) => errors.push(...validateSchema(schema.items, item, `${location}[${index}]`)));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') return [`${location}: se requiere texto`];
    if (value.length < (schema.minLength || 0) || value.length > (schema.maxLength ?? Infinity)) fail('texto fuera del límite');
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) fail('formato inválido');
  } else if (schema.type === 'integer' || schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) return [`${location}: se requiere un número ${schema.type === 'integer' ? 'entero' : 'finito'}`];
    if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) fail('número fuera del límite');
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') fail('se requiere verdadero o falso');
  if (schema.enum && !schema.enum.includes(value)) fail(`valor permitido: ${schema.enum.join(', ')}`);
  return errors;
}

export function schemaDescriptions(schema, location = 'input') {
  const errors = typeof schema.description === 'string' && schema.description.trim() ? [] : [location];
  for (const [name, child] of Object.entries(schema.properties || {})) errors.push(...schemaDescriptions(child, `${location}.${name}`));
  if (schema.items) errors.push(...schemaDescriptions(schema.items, `${location}[]`));
  return errors;
}

export function vendorSchema(schema) {
  // ElevenLabs' current LiteralJsonSchemaProperty accepts string enums but does
  // not expose numeric enums/bounds. Keep full enforcement in runTool; describe
  // those same constraints in the vendor projection rather than coercing types.
  if (!schema.type) return Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, vendorSchema(value)]));
  const notes = [];
  if (schema.enum && schema.type !== 'string') notes.push(`Valores permitidos: ${schema.enum.join(', ')}.`);
  if (schema.minimum !== undefined || schema.maximum !== undefined) notes.push(`Rango permitido: ${schema.minimum ?? 'sin mínimo'} a ${schema.maximum ?? 'sin máximo'}.`);
  if (schema.minLength !== undefined || schema.maxLength !== undefined) notes.push(`Longitud: ${schema.minLength ?? 0} a ${schema.maxLength ?? 'sin máximo'} caracteres.`);
  if (schema.minItems !== undefined || schema.maxItems !== undefined) notes.push(`Cantidad: ${schema.minItems ?? 0} a ${schema.maxItems ?? 'sin máximo'} elementos.`);
  if (schema.pattern) notes.push(`Formato: ${schema.pattern}.`);
  const projected = { type: schema.type, description: [schema.description, ...notes].filter(Boolean).join(' ') };
  if (schema.properties) projected.properties = vendorSchema(schema.properties);
  if (schema.required) projected.required = [...schema.required];
  if (schema.items) projected.items = vendorSchema(schema.items);
  if (schema.enum && schema.type === 'string') projected.enum = [...schema.enum];
  return projected;
}
