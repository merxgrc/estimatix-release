import Handlebars from "handlebars";

export function renderTemplate(templateString: string, data: any) {
  // Register helpers for formatting
  Handlebars.registerHelper('formatCurrency', function(value: number) {
    if (!value) return '';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  });

  Handlebars.registerHelper('hasValue', function(value: any) {
    return value !== null && value !== undefined && value !== '';
  });

  Handlebars.registerHelper('formatNumber', function(value: number) {
    if (value === null || value === undefined) return '';
    return value.toLocaleString('en-US');
  });

  const template = Handlebars.compile(templateString);
  return template(data);
}

