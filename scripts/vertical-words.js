// Hospitality words the product must not ship (root CLAUDE.md, Industry-Neutral).
// One list for every gate that enforces the rule: check-docs.js reads it for the
// user manual, check-industry-neutral.js for the server functions.
//
// "stay" is left out on purpose: as a verb it is ordinary English.
// An underscore counts as a break between words, so a placeholder such as
// {guest_name} is caught too.
const VERTICAL = /(?<![a-z0-9])(guests?|bookings?|reservations?|check-?ins?|check-?outs?|hotels?|nights|hospitality)(?![a-z0-9])/i;

module.exports = { VERTICAL };
