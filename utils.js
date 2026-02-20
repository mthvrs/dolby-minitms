/**
 * Converts a string to a slug.
 * @param {string} s - The string to slugify.
 * @returns {string} The slugified string.
 */
const slugify = (s) => String(s).toLowerCase().replace(/\s+/g, '-');

module.exports = { slugify };
