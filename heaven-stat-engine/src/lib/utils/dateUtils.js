const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseISODate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const parts = dateStr.trim().split('-');
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  if (isNaN(year) || isNaN(month) || isNaN(day) || month < 0 || month > 11 || day < 1 || day > 31) return null;
  return { year, month, day, monthName: MONTHS[month] };
}

export function formatEventDates(startDateStr, endDateStr) {
  const start = parseISODate(startDateStr);
  const end = parseISODate(endDateStr);

  if (!start && !end) return null;

  if (start && !end) {
    return `Starts ${start.monthName} ${start.day}, ${start.year}`;
  }

  if (!start && end) {
    return `Ends ${end.monthName} ${end.day}, ${end.year}`;
  }

  if (start.year === end.year && start.month === end.month && start.day === end.day) {
    return `${start.monthName} ${start.day}, ${start.year}`;
  }

  if (start.year === end.year) {
    return `${start.monthName} ${start.day} – ${end.monthName} ${end.day}, ${start.year}`;
  }

  return `${start.monthName} ${start.day}, ${start.year} – ${end.monthName} ${end.day}, ${end.year}`;
}
