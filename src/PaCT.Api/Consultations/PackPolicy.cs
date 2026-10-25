namespace PaCT.Api.Consultations;

// Shared by the public catalogue and the purchase lifecycle. Calendar months, not 365 days.
public static class PackPolicy
{
    public const int ValidityMonths = 12;
    public const int ReminderMonthsBeforeExpiry = 2;
}
