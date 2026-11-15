/** Pregunta que se le hace a Hanzo a partir del texto seleccionado en la página. */
export function selectionPrompt(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, 1000);
  const words = t.split(' ').length;
  if (words <= 3 && t.length <= 40) {
    return `¿Qué significa «${t}»? Respóndeme breve: una definición simple y un ejemplo corto, según el contexto de esta página.`;
  }
  return `Explícame esto de forma clara y breve, según el contexto de esta página:\n«${t}»`;
}
