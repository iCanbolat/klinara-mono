import SwiftUI
import UIKit

/// Randevu gününü takvimden seçme sayfası.
///
/// Gün gün ok tuşuyla ilerlemek birkaç hafta sonrası için zahmetliydi. Takvim
/// ay ay geziliyor ve kapalı / tatil / geçmiş / pencere dışı günler
/// `GET /availability/days` ile baştan **seçilemez**: kullanıcı önce seçip
/// sonra "bu gün kapalı" mesajı görmek yerine o günleri hiç seçemiyor.
///
/// SwiftUI `DatePicker` tek tek günleri kapatamıyor ve süsleyemiyor;
/// `UICalendarView` ikisini de yapıyor (`canSelectDate`, dekorasyon).
struct BookingDayPickerSheet: View {

    let session: AppSession
    let branchId: String
    let initialDay: Date
    let onPick: (Date) -> Void

    @Environment(\.dismiss) private var dismiss
    /// `yyyy-MM-dd` → durum. Yüklenmeyen gün seçilebilir kabul ediliyor:
    /// ağ yavaşsa takvim kilitlenmemeli; seçilen gün zaten nedeniyle açıklanıyor.
    @State private var statuses: [String: AvailabilityDay] = [:]
    @State private var loadedMonths: Set<String> = []
    /// Görünen ayın ilk günü — tatil adları bu aya göre listeleniyor.
    @State private var visibleMonth: Date?

    private var clock: BranchClock { session.clock }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                BookingCalendarView(
                    clock: clock,
                    initialDay: initialDay,
                    statuses: statuses,
                    onVisibleMonth: { month in
                        visibleMonth = month
                        Task { await loadMonth(month) }
                    },
                    onPick: { day in
                        onPick(day)
                        dismiss()
                    }
                )
                .frame(maxWidth: .infinity)

                legend
                    .padding(.horizontal, KlinaraMetrics.screenInset)

                Spacer(minLength: 0)
            }
            .padding(.top, KlinaraMetrics.sm)
            .background(KlinaraColor.surface.ignoresSafeArea())
            .navigationTitle("Gün seçin")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Kapat") { dismiss() }
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Bugün") {
                        onPick(clock.startOfDay(Date()))
                        dismiss()
                    }
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.sageDeep)
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .tint(KlinaraColor.sage)
    }

    /// Görünen aydaki tatiller — hücre yalnız nokta gösterebiliyor; "neden
    /// seçemiyorum" sorusunun cevabı (tatilin adı) burada.
    private var monthHolidays: [AvailabilityDay] {
        guard let visibleMonth else { return [] }
        let prefix = String(clock.localDateString(visibleMonth).prefix(7))
        return statuses.values
            .filter { $0.status == .holiday && $0.date.hasPrefix(prefix) }
            .sorted { $0.date < $1.date }
    }

    private var legend: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            HStack(spacing: KlinaraMetrics.md) {
                legendItem(color: KlinaraColor.danger, title: "Tatil")
                legendItem(color: KlinaraColor.charcoalMuted, title: "Kapalı")
                Text("Soluk günler seçilemez")
            }
            .accessibilityElement(children: .combine)

            ForEach(monthHolidays, id: \.date) { holiday in
                HStack(spacing: 6) {
                    Circle().fill(KlinaraColor.danger).frame(width: 6, height: 6)
                    Text(holidayLine(holiday))
                        .foregroundStyle(KlinaraColor.charcoal)
                }
            }
        }
        .klinaraText(.bodyM)
        .font(.footnote)
        .foregroundStyle(KlinaraColor.charcoalMuted)
    }

    private func holidayLine(_ day: AvailabilityDay) -> String {
        let date = clock.date(fromLocalDateString: day.date).map { clock.dayPickerLabel($0).title } ?? day.date
        return "\(date) · \(day.holidayName ?? "Tatil")"
    }

    private func legendItem(color: Color, title: String) -> some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(title)
        }
    }

    /// Görünen ayı dış günleriyle (±1 hafta) çeker; aynı ay ikinci kez sorulmaz.
    private func loadMonth(_ monthStart: Date) async {
        let key = clock.localDateString(monthStart)
        guard !loadedMonths.contains(key) else { return }
        loadedMonths.insert(key)
        let from = clock.adding(days: -7, to: monthStart)
        let to = clock.adding(days: 42, to: monthStart)
        do {
            let response = try await session.calendarStore.availabilityDays(
                branchId: branchId,
                from: from,
                to: to
            )
            for day in response.days { statuses[day.date] = day }
        } catch {
            // İşaretleme bir kolaylık: gelmezse takvim yine çalışır. Tekrar
            // denenebilsin diye ay "yüklendi" listesinden çıkarılıyor.
            loadedMonths.remove(key)
        }
    }
}

/// `UICalendarView` sarmalayıcısı.
private struct BookingCalendarView: UIViewRepresentable {

    let clock: BranchClock
    let initialDay: Date
    let statuses: [String: AvailabilityDay]
    let onVisibleMonth: (Date) -> Void
    let onPick: (Date) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> UICalendarView {
        let view = UICalendarView()
        view.calendar = clock.calendar
        view.locale = Locale(identifier: "tr_TR")
        view.timeZone = clock.timeZone
        view.fontDesign = .rounded
        view.tintColor = UIColor(KlinaraColor.sageDeep)
        view.delegate = context.coordinator
        // Geçmiş aylar gezilmiyor: randevu geriye alınmıyor. Üst sınır bir yıl;
        // gerçek sınır (`maxAdvanceDays`) günlerde `beyond_window` olarak görünüyor.
        let today = clock.startOfDay(Date())
        view.availableDateRange = DateInterval(
            start: clock.startOfMonth(today),
            end: clock.adding(months: 12, to: today)
        )

        let selection = UICalendarSelectionSingleDate(delegate: context.coordinator)
        selection.selectedDate = clock.calendar.dateComponents([.year, .month, .day], from: initialDay)
        view.selectionBehavior = selection
        view.visibleDateComponents = clock.calendar.dateComponents([.year, .month], from: initialDay)

        view.setContentHuggingPriority(.required, for: .vertical)
        onVisibleMonth(clock.startOfMonth(initialDay))
        return view
    }

    func updateUIView(_ view: UICalendarView, context: Context) {
        let previous = context.coordinator.parent.statuses
        context.coordinator.parent = self
        // Yalnız değişen günlerin dekorasyonu tazeleniyor; tamamını yenilemek
        // her ay yüklemesinde takvimi titretirdi.
        let changed = statuses.filter { previous[$0.key] != $0.value }.keys
        let components = changed.compactMap { key -> DateComponents? in
            guard let date = clock.date(fromLocalDateString: key) else { return nil }
            return clock.calendar.dateComponents([.year, .month, .day], from: date)
        }
        if !components.isEmpty {
            view.reloadDecorations(forDateComponents: components, animated: true)
        }
    }

    final class Coordinator: NSObject, UICalendarViewDelegate, UICalendarSelectionSingleDateDelegate {

        var parent: BookingCalendarView

        init(parent: BookingCalendarView) { self.parent = parent }

        private func status(for components: DateComponents) -> AvailabilityDay? {
            guard let date = parent.clock.calendar.date(from: components) else { return nil }
            return parent.statuses[parent.clock.localDateString(date)]
        }

        // MARK: Seçim

        func dateSelection(_ selection: UICalendarSelectionSingleDate, canSelectDate components: DateComponents?) -> Bool {
            guard let components else { return false }
            guard let day = status(for: components) else { return true }
            return day.status == .open || day.status == .unknown
        }

        func dateSelection(_ selection: UICalendarSelectionSingleDate, didSelectDate components: DateComponents?) {
            guard let components, let date = parent.clock.calendar.date(from: components) else { return }
            parent.onPick(parent.clock.startOfDay(date))
        }

        // MARK: Süs ve ay değişimi

        func calendarView(_ calendarView: UICalendarView, decorationFor components: DateComponents) -> UICalendarView.Decoration? {
            switch status(for: components)?.status {
            case .holiday:
                return .default(color: UIColor(KlinaraColor.danger), size: .small)
            case .closed:
                return .default(color: UIColor(KlinaraColor.charcoalMuted).withAlphaComponent(0.5), size: .small)
            default:
                return nil
            }
        }

        func calendarView(_ calendarView: UICalendarView, didChangeVisibleDateComponentsFrom previous: DateComponents) {
            guard let month = parent.clock.calendar.date(from: calendarView.visibleDateComponents) else { return }
            parent.onVisibleMonth(parent.clock.startOfMonth(month))
        }
    }
}
