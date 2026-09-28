import { describe, expect, it } from 'vitest';
import type { ConsentRequirements } from '@klinara/shared';
import {
  canSubmit,
  initialForm,
  isScrolledToEnd,
  nextDocumentForm,
  pendingDocuments,
  safeReturnPath,
  signatureInput,
  withRelation,
  type SignerForm,
} from '../../src/lib/consent/signing-flow';

const READY: SignerForm = {
  signerName: 'Ayşe Yılmaz',
  relation: 'self',
  guardianOfName: '',
  acknowledged: true,
  scrolledToEnd: true,
  hasInk: true,
};

describe('imza modu kuralları', () => {
  it('kaydırmadan, onay kutusu ve imza olmadan onaylanamaz', () => {
    expect(canSubmit(READY)).toBe(true);
    expect(canSubmit({ ...READY, scrolledToEnd: false })).toBe(false);
    expect(canSubmit({ ...READY, acknowledged: false })).toBe(false);
    expect(canSubmit({ ...READY, hasInk: false })).toBe(false);
    expect(canSubmit({ ...READY, signerName: ' A ' })).toBe(false);
  });

  it('veli imzasında hastanın adı zorunlu', () => {
    const guardian: SignerForm = { ...READY, relation: 'guardian', signerName: 'Veli Yılmaz' };
    expect(canSubmit(guardian)).toBe(false);
    expect(canSubmit({ ...guardian, guardianOfName: 'Ece Yılmaz' })).toBe(true);
  });

  it('ilişki değişince hastanın adı doğru alana taşınır', () => {
    const self = initialForm('Ece Yılmaz');
    expect(self.signerName).toBe('Ece Yılmaz');
    const guardian = withRelation(self, 'guardian', 'Ece Yılmaz');
    expect(guardian).toMatchObject({ signerName: '', guardianOfName: 'Ece Yılmaz' });
    expect(withRelation(guardian, 'self', 'Ece Yılmaz')).toMatchObject({
      signerName: 'Ece Yılmaz',
      guardianOfName: '',
    });
  });

  it('sonraki belgede kimlik korunur; okuma, onay ve imza sıfırlanır', () => {
    const next = nextDocumentForm(READY);
    expect(next).toMatchObject({ signerName: 'Ayşe Yılmaz', relation: 'self' });
    expect(next).toMatchObject({ acknowledged: false, scrolledToEnd: false, hasInk: false });
  });

  it('bekleyen belgeler sunucunun sırasıyla ve yalnız eksik olanlar', () => {
    const requirements: ConsentRequirements = {
      appointmentId: 'a1',
      customerId: 'c1',
      customerName: 'Ayşe',
      missingCount: 1,
      items: [
        {
          kind: 'kvkk_explicit',
          templateId: null,
          title: 'KVKK',
          satisfied: true,
          signatureId: 's1',
          document: null,
        },
        {
          kind: 'treatment',
          templateId: 't1',
          title: 'Botoks',
          satisfied: false,
          signatureId: null,
          document: {
            kind: 'treatment',
            documentId: 'v1',
            title: 'Botoks',
            version: 2,
            body: 'metin',
            sha256: 'h',
          },
        },
      ],
    };
    expect(pendingDocuments(requirements).map((doc) => doc.documentId)).toEqual(['v1']);
  });

  it('istek gövdesi: veli adı yalnız veli imzasında gider, adlar kırpılır', () => {
    const document = {
      kind: 'treatment' as const,
      documentId: 'v1',
      title: 'B',
      version: 1,
      body: 'x',
      sha256: 'h',
    };
    expect(signatureInput(document, { ...READY, signerName: ' Ayşe ' }, 'png')).toEqual({
      kind: 'treatment',
      documentId: 'v1',
      textSha256: 'h',
      signerName: 'Ayşe',
      signerRelation: 'self',
      signaturePng: 'png',
    });
    expect(
      signatureInput(document, { ...READY, relation: 'guardian', guardianOfName: ' Ece ' }, 'png'),
    ).toMatchObject({ signerRelation: 'guardian', guardianOfName: 'Ece' });
  });

  it('metnin sonuna gelme payı', () => {
    expect(isScrolledToEnd({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 })).toBe(true);
    expect(isScrolledToEnd({ scrollTop: 594, clientHeight: 400, scrollHeight: 1000 })).toBe(true);
    expect(isScrolledToEnd({ scrollTop: 500, clientHeight: 400, scrollHeight: 1000 })).toBe(false);
  });

  it('dönüş adresi yalnız uygulama içi göreli yol', () => {
    expect(safeReturnPath('/takvim', '/x')).toBe('/takvim');
    expect(safeReturnPath(null, '/x')).toBe('/x');
    expect(safeReturnPath('https://kotu.site', '/x')).toBe('/x');
    expect(safeReturnPath('//kotu.site', '/x')).toBe('/x');
    expect(safeReturnPath('/\\kotu.site', '/x')).toBe('/x');
  });
});
