export const theme = {
  color: {
    surface: '#0A0B0E',
    onSurface: '#F2F3F7',
    surface2: '#14161C',
    onSurface2: '#9CA3AF',
    surface3: '#1F222B',
    onSurface3: '#8E96A4',
    brand: '#E0115F',
    brandDim: '#B30E4C',
    brandTint: '#3E0F21',
    onBrand: '#FFFFFF',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    border: '#272A35',
    borderStrong: '#373C4B',
    divider: '#1F222B',
  },
  radius: { sm: 6, md: 12, lg: 20, xl: 28, pill: 999 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  font: {
    display: 'System',
    text: 'System',
  },
};

export type Theme = typeof theme;
