// ============================================================================
// Kalta – Custom products management
// Lists all cached products (from EAN scans, Claude Vision, manual entry)
// in this warehouse. User can edit name/category or delete.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  deleteCustomProduct,
  getActiveUserId,
  listCustomProducts,
  upsertCustomProduct,
} from '@/src/lib/supabase';
import type { CustomProduct } from '@/src/types/database';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';
import { Card } from '@/src/components/Card';

export default function ProductsScreen() {
  const router = useRouter();
  const { warehouseId } = useLocalSearchParams<{ warehouseId: string }>();
  const [products, setProducts] = useState<CustomProduct[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    try {
      const rows = await listCustomProducts(warehouseId);
      setProducts(rows);
    } catch {
      // ignore
    }
  }, [warehouseId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const handleProductAction = (product: CustomProduct) => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Edit name', 'Delete', 'Cancel'],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
        title: product.name,
        message: product.barcode ? `Barcode: ${product.barcode}` : undefined,
      },
      async (idx) => {
        if (idx === 0) {
          Alert.prompt(
            'Edit product name',
            `Change the cached name for barcode ${product.barcode ?? '(none)'}`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Save',
                onPress: async (text?: string) => {
                  const trimmed = (text ?? '').trim();
                  if (!trimmed) return;
                  try {
                    const uid = (await getActiveUserId()) ?? '';
                    await upsertCustomProduct({
                      warehouse_id: product.warehouse_id,
                      barcode: product.barcode,
                      name: trimmed,
                      category: product.category,
                      image_url: product.image_url,
                      typical_expiry_days: product.typical_expiry_days,
                      created_by: uid,
                    });
                    await load();
                  } catch (e: any) {
                    Alert.alert('Error', e?.message ?? 'Cannot save.');
                  }
                },
              },
            ],
            'plain-text',
            product.name,
          );
        } else if (idx === 1) {
          Alert.alert(
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
                    Alert.alert('Error', e?.message ?? 'Cannot delete.');
                  }
                },
              },
            ],
          );
        }
      },
    );
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

      {products.length === 0 ? (
        <View style={styles.center}>
          <Icon sf="barcode" size={48} color={colors.textSubtle} />
          <Text style={styles.emptyTitle}>No cached products</Text>
          <Text style={styles.emptyText}>Scan product barcodes to build up the cache.</Text>
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          renderItem={({ item: product }) => (
            <Card
              onPress={() => handleProductAction(product)}
              style={styles.card}
            >
              <View style={styles.cardBody}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {product.name}
                </Text>
                <Text style={styles.cardBarcode} numberOfLines={1}>
                  {product.barcode}
                  {product.category ? ` · ${product.category}` : ''}
                  {product.typical_expiry_days
                    ? ` · ~${Math.round(product.typical_expiry_days / 365)}y shelf`
                    : ''}
                </Text>
              </View>
              <Icon sf="ellipsis" size={16} color={colors.textSubtle} />
            </Card>
          )}
        />
      )}
    </SafeAreaView>
  );
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
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md + 2,
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  cardName: {
    ...typography.headline,
    color: colors.text,
  },
  cardBarcode: {
    ...typography.footnote,
    color: colors.textMuted,
  },
});
