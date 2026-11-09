/**
 * Re-points the secondary text colour at a neutral grey for everything inside the element it is put
 * on. The palette's own secondary text carries a blue tint; on the landing page, descriptions read
 * as plain grey.
 *
 * The grey is built from the theme's text colour: its lightness is kept (and eased towards the
 * middle), its colour is dropped. On the dark surfaces that is a light grey, on the light ones a deep
 * neutral grey, and it follows the theme toggle and the `scope-dark` regions with no extra rules.
 * Lightness works out to about 0.87 on dark and 0.40 on light, both well above 4.5:1 against the
 * page. Raise the 0.29 to lighten both, or the 0.6 to widen the gap between the two themes.
 *
 * It is a custom-property override, so it only reaches the landing page. Put it on a child of a
 * `scope-dark` region, never on the region itself, which declares its own value and would win.
 */
export const SOFT_TEXT =
  "[--color-fg-secondary:oklab(from_var(--color-fg)_calc(0.29_+_0.6_*_l)_0_0)]";
