/**
 * UI-R004 — on a form, every word a worker reads is black.
 *
 * The same rule and the same colours as the phone app
 * (ireps-mobile/src/theme/formColors.js). A form looks the same to the
 * office as it does to the field.
 *
 * No screen writes a colour of its own. It takes it from here.
 */

// Every word on a form: the field name, the value in the box, the hint
// inside an empty box, helper lines and section headings.
export const FORM_TEXT = "#000000";

// The hint inside an empty box.
export const FORM_PLACEHOLDER = "#000000";

// An error stays red. It is a signal, not a word to read past.
export const FORM_ERROR = "#dc2626";
