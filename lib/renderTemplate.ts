import Handlebars from "handlebars";

export function renderTemplate(templateString: string, data: any) {
  // Register helpers for formatting
  Handlebars.registerHelper('formatCurrency', function(value: number) {
    if (value === null || value === undefined || value === 0) return '';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  });

  Handlebars.registerHelper('hasValue', function(value: any) {
    return value !== null && value !== undefined && value !== '';
  });

  Handlebars.registerHelper('formatNumber', function(value: number) {
    if (value === null || value === undefined) return '';
    return value.toLocaleString('en-US');
  });

  Handlebars.registerHelper('gt', function(a: any, b: any) {
    return a > b;
  });

  Handlebars.registerHelper('lt', function(a: any, b: any) {
    return a < b;
  });

  Handlebars.registerHelper('eq', function(a: any, b: any) {
    return a === b;
  });

  Handlebars.registerHelper('isArray', function(value: any) {
    return Array.isArray(value);
  });

  const template = Handlebars.compile(templateString);
  return template(data);
}

