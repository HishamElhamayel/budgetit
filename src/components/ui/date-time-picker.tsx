/**
 * The platform date/time picker.
 *
 * A pass-through on native. It exists as its own module so web can swap in
 * `date-time-picker.web.tsx` — the community picker has no web implementation
 * and renders `null` there, which leaves every date field in the app silently
 * empty in the browser.
 */

export { default } from '@react-native-community/datetimepicker';
