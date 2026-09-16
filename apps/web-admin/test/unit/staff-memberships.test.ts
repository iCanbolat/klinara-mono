import { describe, expect, it } from 'vitest';
import {
  assignableRolesFor,
  editorLock,
  membershipLock,
  sameMemberships,
  staffBranchIds,
  toInputs,
  validateMemberships,
} from '../../src/lib/staff/memberships';
import { slugify } from '../../src/lib/branches/slug';

const OWNER = { user: { id: 'o' }, roles: ['owner'], branchIds: [], tenantWide: true };
const MANAGER_B1 = { user: { id: 'm' }, roles: ['manager'], branchIds: ['b1'], tenantWide: false };

describe('rol/şube kuralları', () => {
  it('kimse kendinden YÜKSEK rütbeli rol atayamıyor', () => {
    expect(assignableRolesFor(OWNER)).toEqual([
      'owner',
      'manager',
      'accountant',
      'receptionist',
      'practitioner',
    ]);
    expect(assignableRolesFor(MANAGER_B1)).not.toContain('owner');
    expect(assignableRolesFor(MANAGER_B1)).toContain('manager');
  });

  it('satır kilidi: rütbe ve erişilemeyen şube', () => {
    expect(membershipLock(MANAGER_B1, { roleKey: 'owner', branchId: null })).toBe('rank');
    expect(membershipLock(MANAGER_B1, { roleKey: 'practitioner', branchId: 'b2' })).toBe('branch');
    expect(membershipLock(MANAGER_B1, { roleKey: 'practitioner', branchId: 'b1' })).toBeNull();
    expect(membershipLock(OWNER, { roleKey: 'practitioner', branchId: 'b2' })).toBeNull();
  });

  it('erişilemeyen tek bir şube satırı TÜM düzenleyiciyi kilitliyor; kendi rolü de kilitli', () => {
    const rows = [
      { roleKey: 'practitioner', branchId: 'b1' },
      { roleKey: 'receptionist', branchId: 'b2' },
    ];
    expect(editorLock(MANAGER_B1, 'u1', rows)).toBe('branch');
    expect(editorLock(OWNER, 'u1', rows)).toBeNull();
    expect(editorLock(OWNER, 'o', rows)).toBe('self');
    // Rütbe kilidi düzenleyiciyi kilitlemiyor — satır olduğu gibi geri gider.
    expect(editorLock(MANAGER_B1, 'u1', [{ roleKey: 'owner', branchId: null }])).toBeNull();
  });

  it('doğrulama: şube kapsamlı rolde şube zorunlu, tekrar yasak', () => {
    const issues = validateMemberships([
      { key: 'a', roleKey: 'practitioner', branchId: null },
      { key: 'b', roleKey: 'receptionist', branchId: 'b1' },
      { key: 'c', roleKey: 'receptionist', branchId: 'b1' },
      { key: 'd', roleKey: 'accountant', branchId: null },
    ]);
    expect(issues).toEqual({ a: 'branchRequired', c: 'duplicate' });
  });

  it('kiracı kapsamlı rol şubesiz gönderiliyor', () => {
    expect(
      toInputs([
        { key: 'a', roleKey: 'accountant', branchId: null },
        { key: 'b', roleKey: 'manager', branchId: 'b1' },
      ]),
    ).toEqual([{ roleKey: 'accountant' }, { roleKey: 'manager', branchId: 'b1' }]);
  });

  it('karşılaştırma sıradan bağımsız', () => {
    const a = [
      { roleKey: 'manager', branchId: 'b1' },
      { roleKey: 'accountant', branchId: null },
    ];
    expect(sameMemberships(a, [...a].reverse())).toBe(true);
    expect(sameMemberships(a, a.slice(0, 1))).toBe(false);
  });

  it('personelin şubeleri = üyelik şubeleri ∪ ana şube (tekrarsız)', () => {
    expect(staffBranchIds({ branchIds: ['b1', 'b2'], primaryBranchId: 'b2' }).sort()).toEqual(['b1', 'b2']);
    expect(staffBranchIds({ branchIds: [], primaryBranchId: 'b3' })).toEqual(['b3']);
    expect(staffBranchIds({ branchIds: [], primaryBranchId: null })).toEqual([]);
  });
});

describe('şube kodu', () => {
  it('Türkçe adı sunucunun slug kuralına çeviriyor', () => {
    expect(slugify('İzmir Alsancak')).toBe('izmir-alsancak');
    expect(slugify('  Nişantaşı / Şişli  ')).toBe('nisantasi-sisli');
    expect(slugify('Çeşme Ğ Üsküdar Ö')).toBe('cesme-g-uskudar-o');
    expect(slugify('x'.repeat(60))).toHaveLength(50);
  });
});
