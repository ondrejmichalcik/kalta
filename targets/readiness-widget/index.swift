// ============================================================================
// Kalta – Readiness home-screen widget (WidgetKit)
// Reads a small readiness summary the app writes into the shared App Group
// UserDefaults (group.com.ondrejmichalcik.kalta) — days of supply, tone, and
// the count of items expiring soon. The widget itself runs no JS / SQLite.
// ============================================================================
import WidgetKit
import SwiftUI

private let appGroup = "group.com.ondrejmichalcik.kalta"

struct ReadinessEntry: TimelineEntry {
  let date: Date
  let days: Int
  let tone: String
  let expiring: Int
  let warehouse: String
  let configured: Bool
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> ReadinessEntry {
    ReadinessEntry(date: Date(), days: 14, tone: "green", expiring: 0, warehouse: "Home", configured: true)
  }

  func getSnapshot(in context: Context, completion: @escaping (ReadinessEntry) -> Void) {
    completion(readEntry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<ReadinessEntry>) -> Void) {
    // The app calls reloadAllTimelines on every data change; this hourly
    // policy is just a safety refresh.
    let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
    completion(Timeline(entries: [readEntry()], policy: .after(next)))
  }

  private func readEntry() -> ReadinessEntry {
    let d = UserDefaults(suiteName: appGroup)
    let configured = d?.object(forKey: "readinessDays") != nil
    return ReadinessEntry(
      date: Date(),
      days: d?.integer(forKey: "readinessDays") ?? 0,
      tone: d?.string(forKey: "readinessTone") ?? "none",
      expiring: d?.integer(forKey: "expiringCount") ?? 0,
      warehouse: d?.string(forKey: "warehouseName") ?? "Kalta",
      configured: configured
    )
  }
}

private func toneColor(_ tone: String) -> Color {
  switch tone {
  case "green": return Color(red: 0.18, green: 0.49, blue: 0.20)
  case "amber": return Color(red: 0.80, green: 0.52, blue: 0.00)
  case "red": return Color(red: 0.78, green: 0.16, blue: 0.16)
  default: return .gray
  }
}

struct KaltaReadinessView: View {
  var entry: ReadinessEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(entry.warehouse)
        .font(.caption2)
        .foregroundColor(.secondary)
        .lineLimit(1)

      if entry.configured {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
          Text("\(entry.days)")
            .font(.system(size: 34, weight: .bold))
            .foregroundColor(toneColor(entry.tone))
          Text(entry.days == 1 ? "day ready" : "days ready")
            .font(.caption)
            .foregroundColor(.secondary)
        }
        Spacer(minLength: 0)
        if entry.expiring > 0 {
          Label("\(entry.expiring) expiring soon", systemImage: "clock.badge.exclamationmark")
            .font(.caption2)
            .foregroundColor(.orange)
            .lineLimit(1)
        } else {
          Label("Stocked", systemImage: "checkmark.seal.fill")
            .font(.caption2)
            .foregroundColor(.secondary)
            .lineLimit(1)
        }
      } else {
        Spacer(minLength: 0)
        Text("Open Kalta to set up readiness")
          .font(.caption2)
          .foregroundColor(.secondary)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .padding()
    .widgetURL(URL(string: "kalta://"))
  }
}

@main
struct KaltaReadinessWidget: Widget {
  let kind = "KaltaReadinessWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in
      if #available(iOS 17.0, *) {
        KaltaReadinessView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
      } else {
        KaltaReadinessView(entry: entry)
      }
    }
    .configurationDisplayName("Readiness")
    .description("Days of supply and items expiring soon.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
