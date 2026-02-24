// Notification templates
export function renderTemplate(name: string, data: Record<string, string>): string {
  // Render HTML template with data substitution
  return `<html><body>${name}: ${JSON.stringify(data)}</body></html>`;
}
