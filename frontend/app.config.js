module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    backendUrl: process.env.REELDIRECTOR_API_URL || 'https://reeldirector-api.onrender.com',
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
    supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
  },
});
