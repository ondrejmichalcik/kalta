// ============================================================================
// Kalta – Custom products management
// Lists cached products (from EAN scans, Claude Vision, manual entry) in
// this warehouse. User can edit name / category / shelf-life hint, delete,
// or filter by name/barcode.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { showAlert, toast } from '@/src/lib/feedback';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  deleteCustomProduct,
  getActiveUserId,
  listCustomProducts,
  upsertCustomProduct,
  applyProductAttributesToItems,
} from '@/src/lib/supabase';
import { getCachedUri } from '@/src/lib/imageCache';
import type { Category, CustomProduct } from '@/src/types/database';
import { CATEGORIES, CATEGORY_ICON, CATEGORY_LABEL } from '@/src/types/database';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';
import { Card } from '@/src/components/Card';

// Shelf-life presets shown as chips under the days input. Tap = sets the
// number; user can still type any custom value.
const SHELF_LIFE_PRESETS: Array<{ label: string; days: number }> = [
  { label: '1 month', days: 30 },
  { label: '6 months', days: 180 },
  { label: '1 year', days: 365 },
  { label: '2 years', days: 730 },
  { label: '5 years', days: 1825 },
  { label: '10 years', days: 3650 },
];

export default function ProductsScreen() {
  const router = useRouter();
  const { warehouseId } = useLocalSearchParams<{ warehouseId: string }>();
  const [products, setProducts] = useState<CustomProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<CustomProduct | null>(null);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    try {
      const rows = await listCustomProducts(warehouseId);
      setProducts(rows);
    } catch {
      // ignore — empty list is acceptable fallback
    }
  }, [warehouseId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode ?? '').toLowerCase().includes(q),
    );
  }, [products, query]);

  const handleDelete = (product: CustomProduct) => {
    showAlert(
      'Delete product',
      `Remove "${product.name}" from the product cache? Future scans of this barcode will look up Open Food Facts again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCustomProduct(product.id);
              setProducts((prev) => prev.filter((p) => p.id !== product.id));
            } catch (e: any) {
              toast.error(e?.message ?? 'Cannot delete.');
            }
          },
        },
      ],
    );
  };

  const handleSaveEdit = async (patched: {
    name: string;
    category: Category | null;
    typical_expiry_days: number | null;
    energy_kcal_per_100g: number | null;
    net_weight_g: number | null;
  }) => {
    if (!editing) return;
    const trimmed = patched.name.trim();
    if (!trimmed) {
      toast.info('Product name cannot be empty.');
      return;
    }
    try {
      const uid = (await getActiveUserId()) ?? '';
      await upsertCustomProduct({
        warehouse_id: editing.warehouse_id,
        barcode: editing.barcode,
        name: trimmed,
        category: patched.category,
        image_url: editing.image_url,
        typical_expiry_days: patched.typical_expiry_days,
        created_by: uid,
        energy_kcal_per_100g: patched.energy_kcal_per_100g,
        net_weight_g: patched.net_weight_g,
      });
      // Propagate the product-level nutrition to every stocked instance.
      await applyProductAttributesToItems(editing.warehouse_id, editing.barcode, {
        energy_kcal_per_100g: patched.energy_kcal_per_100g,
        net_weight_g: patched.net_weight_g,
      });
      setEditing(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Cannot save.');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable
          hitSlop={12}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.topBarBtn, pressed && { opacity: 0.5 }]}
        >
          <Icon sf="chevron.left" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.topBarTitle}>Product cache</Text>
        <View style={styles.topBarBtn} />
      </View>

      <Text style={styles.hint}>
        Products scanned via barcode or identified by AI are cached here.
        Next scan of the same barcode prefills from this cache.
      </Text>

      {products.length > 0 ? (
        <View style={styles.searchWrap}>
          <Icon sf="magnifyingglass" size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search name or barcode"
            placeholderTextColor={colors.textSubtle}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
        </View>
      ) : null}

      {products.length === 0 ? (
        <View style={styles.center}>
          <Icon sf="barcode" size={48} color={colors.textSubtle} />
          <Text style={styles.emptyTitle}>No cached products</Text>
          <Text style={styles.emptyText}>Scan product barcodes to build up the cache.</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No matches</Text>
          <Text style={styles.emptyText}>Try a different name or barcode.</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: product }) => (
            <Card style={styles.card} onPress={() => setEditing(product)}>
              <ProductThumbnail
                imageUrl={product.image_url}
                category={product.category as Category | null}
              />
              <View style={styles.cardBody}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {product.name}
                </Text>
                <Text style={styles.cardMeta} numberOfLines={1}>
                  {product.barcode}
                  {product.category ? ` · ${CATEGORY_LABEL[product.category as Category] ?? product.category}` : ''}
                  {product.typical_expiry_days
                    ? ` · ${formatShelfHint(product.typical_expiry_days)}`
                    : ''}
                </Text>
              </View>
              <Pressable
                onPress={() => handleDelete(product)}
                hitSlop={12}
                style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.5 }]}
                accessibilityLabel={`Delete ${product.name}`}
              >
                <Icon sf="trash" size={18} color={colors.danger} />
              </Pressable>
            </Card>
          )}
        />
      )}

      <EditSheet
        product={editing}
        onClose={() => setEditing(null)}
        onSave={handleSaveEdit}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Thumbnail — cached image, falling back to the category icon

function ProductThumbnail({
  imageUrl,
  category,
}: {
  imageUrl: string | null;
  category: Category | null;
}) {
  const cached = getCachedUri(imageUrl ?? null);
  if (cached) {
    return (
      <Image
        source={{ uri: cached }}
        style={styles.thumbnail}
        resizeMode="cover"
      />
    );
  }
  return (
    <View style={[styles.thumbnail, styles.thumbnailFallback]}>
      <Icon
        brand={(category ? CATEGORY_ICON[category] : 'box-generic') as any}
        size={32}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Edit sheet — replaces the old single-field Alert.prompt flow

function EditSheet({
  product,
  onClose,
  onSave,
}: {
  product: CustomProduct | null;
  onClose: () => void;
  onSave: (patch: {
    name: string;
    category: Category | null;
    typical_expiry_days: number | null;
    energy_kcal_per_100g: number | null;
    net_weight_g: number | null;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category | null>(null);
  const [shelfDays, setShelfDays] = useState('');
  const [energyText, setEnergyText] = useState('');
  const [netWeightText, setNetWeightText] = useState('');

  useEffect(() => {
    if (!product) return;
    setName(product.name ?? '');
    setCategory((product.category as Category | null) ?? null);
    setShelfDays(
      product.typical_expiry_days != null
        ? String(product.typical_expiry_days)
        : '',
    );
    setEnergyText(product.energy_kcal_per_100g != null ? String(product.energy_kcal_per_100g) : '');
    setNetWeightText(product.net_weight_g != null ? String(product.net_weight_g) : '');
  }, [product]);

  if (!product) return null;

  const parsedDays = (() => {
    const trimmed = shelfDays.trim();
    if (!trimmed) return null;
    const n = parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  })();

  const parsePositive = (text: string): number | null => {
    const trimmed = text.trim().replace(',', '.');
    if (!trimmed) return null;
    const n = parseFloat(trimmed);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  };
  const isFoodOrWater = category === 'food' || category === 'water';
  const parsedEnergy = isFoodOrWater ? parsePositive(energyText) : null;
  const parsedNetWeight = isFoodOrWater ? parsePositive(netWeightText) : null;

  return (
    <Modal
      visible={product != null}
      presentationStyle="pageSheet"
      animationType="slide"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.sheetContainer} edges={['top']}>
        <View style={styles.sheetHeader}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.sheetHeaderBtn}>Cancel</Text>
          </Pressable>
          <Text style={styles.sheetHeaderTitle} numberOfLines={1}>
            Edit product
          </Text>
          <Pressable
            onPress={() =>
              onSave({
                name,
                category,
                typical_expiry_days: parsedDays,
                energy_kcal_per_100g: parsedEnergy,
                net_weight_g: parsedNetWeight,
              })
            }
            hitSlop={12}
          >
            <Text style={[styles.sheetHeaderBtn, styles.sheetHeaderBtnPrimary]}>
              Save
            </Text>
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.sheetBody}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.sheetSection}>Barcode</Text>
            <Text style={styles.sheetReadonly}>{product.barcode}</Text>

            <Text style={styles.sheetSection}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              autoCorrect={false}
              autoCapitalize="sentences"
              placeholder="Product name"
              placeholderTextColor={colors.textSubtle}
            />

            <Text style={styles.sheetSection}>Category</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {CATEGORIES.map((c) => {
                const active = category === c;
                return (
                  <Pressable
                    key={c}
                    onPress={() => setCategory(active ? null : c)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {c}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={styles.sheetSection}>Typical shelf life</Text>
            <View style={styles.shelfRow}>
              <TextInput
                style={[styles.input, styles.shelfInput]}
                value={shelfDays}
                onChangeText={setShelfDays}
                keyboardType="number-pad"
                placeholder="—"
                placeholderTextColor={colors.textSubtle}
              />
              <Text style={styles.shelfUnit}>days</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {SHELF_LIFE_PRESETS.map((p) => {
                const active = parsedDays === p.days;
                return (
                  <Pressable
                    key={p.label}
                    onPress={() => setShelfDays(String(p.days))}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text style={styles.sheetHint}>
              Used as a hint when adding new items with this barcode and no
              explicit expiry date.
            </Text>

            {isFoodOrWater && (
              <>
                <Text style={styles.sheetSection}>Nutrition</Text>
                <View style={styles.shelfRow}>
                  <TextInput
                    style={[styles.input, styles.shelfInput]}
                    value={energyText}
                    onChangeText={setEnergyText}
                    keyboardType="decimal-pad"
                    placeholder="—"
                    placeholderTextColor={colors.textSubtle}
                  />
                  <Text style={styles.shelfUnit}>kcal / 100 g</Text>
                </View>
                <View style={[styles.shelfRow, { marginTop: spacing.sm }]}>
                  <TextInput
                    style={[styles.input, styles.shelfInput]}
                    value={netWeightText}
                    onChangeText={setNetWeightText}
                    keyboardType="decimal-pad"
                    placeholder="—"
                    placeholderTextColor={colors.textSubtle}
                  />
                  <Text style={styles.shelfUnit}>g / unit (net weight)</Text>
                </View>
                <Text style={styles.sheetHint}>
                  Saving updates every stocked item with this barcode and
                  pre-fills future scans. Used for readiness (days of food).
                </Text>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function formatShelfHint(days: number): string {
  if (days >= 365) {
    const years = Math.round(days / 365);
    return `~${years}y shelf`;
  }
  if (days >= 30) {
    const months = Math.round(days / 30);
    return `~${months}mo shelf`;
  }
  return `~${days}d shelf`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
    gap: spacing.md,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  topBarBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  topBarTitle: {
    ...typography.headline,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: spacing.sm,
  },
  hint: {
    ...typography.footnote,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    lineHeight: 19,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    paddingVertical: 0,
  },
  emptyTitle: {
    ...typography.title3,
    color: colors.text,
  },
  emptyText: {
    ...typography.subhead,
    color: colors.textMuted,
    textAlign: 'center',
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  card: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  thumbnail: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTint,
  },
  thumbnailFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  cardName: {
    ...typography.headline,
    color: colors.text,
  },
  cardMeta: {
    ...typography.footnote,
    color: colors.textMuted,
  },
  deleteBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Sheet
  sheetContainer: { flex: 1, backgroundColor: colors.background },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  sheetHeaderTitle: {
    ...typography.headline,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: spacing.sm,
  },
  sheetHeaderBtn: {
    ...typography.body,
    color: colors.text,
  },
  sheetHeaderBtnPrimary: {
    color: colors.primary,
    fontWeight: '600',
  },
  sheetBody: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  sheetSection: {
    ...typography.footnote,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.md,
  },
  sheetReadonly: {
    ...typography.body,
    color: colors.textMuted,
    paddingVertical: spacing.sm,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  sheetHint: {
    ...typography.footnote,
    color: colors.textSubtle,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  shelfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  shelfInput: {
    flex: 1,
  },
  shelfUnit: {
    ...typography.body,
    color: colors.textMuted,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    ...typography.footnote,
    color: colors.text,
  },
  chipTextActive: {
    color: colors.textOnPrimary,
    fontWeight: '600',
  },
});
