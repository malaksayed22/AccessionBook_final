/**
 * Where visitors can reach the team, shown in the closing section of the landing page.
 *
 * PLACEHOLDERS: replace these with the real ones before launch.
 * - `email`: the address shown on the email button.
 * - `whatsappUrl`: `https://wa.me/` followed by the number in international format, digits only.
 * - `bookingUrl`: where the "Book" button goes. It opens an email for now; point it at a calendar
 *   link (Cal.com, Calendly, ...) once there is one.
 */
const email = "hello@accessionbook.com";

export const CONTACT = {
  email,
  whatsappUrl: "https://wa.me/15550000000",
  bookingUrl: `mailto:${email}?subject=Booking%20request`,
} as const;
