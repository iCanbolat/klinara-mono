import SwiftUI

/// Prim kuralı formunun düzenlenebilir durumu.
///
/// Form ayrı bir tip: ``PackageDefinitionForm`` ile aynı gerekçe — ekran
/// çizimi ile "bu gövde sunucuya nasıl gider" sorusu birbirine karışmasın.
///
/// **Değiştirilemeyen alanlar burada da görünür.** Sunucu kapsam, matrah ve
/// tetikleyiciyi güncellemede kabul etmiyor: geçmiş tahakkuklar o kurala göre
/// doğdu ve kuralın anlamını sonradan değiştirmek onları yalan yapardı.
@MainActor
@Observable
final class CommissionRuleForm {

    var name = ""
    var scope: CommissionScope = .global
    var scopeRefId: String?
    var staffProfileId: String?
    var calcKind: CommissionCalcKind = .percent
    /// Kullanıcı **yüzde** girer (10 = %10); sunucuya baz puan gider.
    var percentText = ""
    var fixedAmountMinor: Int?
    var basis: CommissionBasis = .netAfterDiscount
    var triggerOn: CommissionTrigger = .serviceCompleted
    var priority = 0
    var effectiveFrom: String?
    var effectiveTo: String?
    var isActive = true

    let editingId: String?
    let editingVersion: Int?

    init() {
        editingId = nil
        editingVersion = nil
    }

    init(editing rule: CommissionRule) {
        editingId = rule.id
        editingVersion = rule.version
        name = rule.name
        scope = rule.scope
        scopeRefId = rule.scopeRefId
        staffProfileId = rule.staffProfileId
        calcKind = rule.calcKind
        switch rule.calcKind {
        case .percent: percentText = Self.percentText(fromBasisPoints: rule.value)
        case .fixed: fixedAmountMinor = rule.value
        }
        basis = rule.basis
        triggerOn = rule.triggerOn
        priority = rule.priority
        effectiveFrom = rule.effectiveFrom
        effectiveTo = rule.effectiveTo
        isActive = rule.isActive
    }

    var isEditing: Bool { editingId != nil }

    /// Sunucunun beklediği değer: `percent` için baz puan, `fixed` için kuruş.
    var value: Int? {
        switch calcKind {
        case .percent: Self.basisPoints(fromPercentText: percentText)
        case .fixed: fixedAmountMinor
        }
    }

    var isValid: Bool {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        guard let value, value >= 0 else { return false }
        if calcKind == .percent, value > 10_000 { return false }
        if scope.needsReference, scopeRefId == nil { return false }
        return true
    }

    func createInput() -> CreateCommissionRuleInput {
        CreateCommissionRuleInput(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            scope: scope,
            scopeRefId: scope.needsReference ? scopeRefId : nil,
            staffProfileId: staffProfileId,
            calcKind: calcKind,
            value: value ?? 0,
            basis: basis,
            triggerOn: triggerOn,
            priority: priority,
            effectiveFrom: effectiveFrom,
            effectiveTo: effectiveTo
        )
    }

    func updateInput() -> UpdateCommissionRuleInput {
        UpdateCommissionRuleInput(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            value: value,
            priority: priority,
            effectiveTo: effectiveTo,
            isActive: isActive
        )
    }

    // MARK: Yüzde ↔ baz puan

    /// "12,5" → 1250. Virgül ve nokta ikisi de kabul; ``Money/parse(_:)`` ile
    /// aynı hoşgörü, çünkü kullanıcı ikisini de yazıyor.
    static func basisPoints(fromPercentText text: String) -> Int? {
        let normalized = text
            .replacingOccurrences(of: "%", with: "")
            .replacingOccurrences(of: ",", with: ".")
            .trimmingCharacters(in: .whitespaces)
        guard !normalized.isEmpty else { return nil }
        let decimal = NSDecimalNumber(string: normalized, locale: Locale(identifier: "en_US_POSIX"))
        guard decimal != .notANumber else { return nil }
        let scaled = decimal.multiplying(by: 100, withBehavior: NSDecimalNumberHandler(
            roundingMode: .bankers,
            scale: 0,
            raiseOnExactness: false,
            raiseOnOverflow: false,
            raiseOnUnderflow: false,
            raiseOnDivideByZero: false
        ))
        guard scaled.compare(NSDecimalNumber.zero) != .orderedAscending else { return nil }
        return scaled.intValue
    }

    static func percentText(fromBasisPoints value: Int) -> String {
        let percent = Double(value) / 100
        return percent == percent.rounded()
            ? String(Int(percent))
            : String(format: "%.2f", percent).replacingOccurrences(of: ".", with: ",")
    }
}
