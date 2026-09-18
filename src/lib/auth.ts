import { supabase } from './supabase'

// Re-checks the signed-in staff account's real password against Supabase
// Auth (not a client-side comparison) — used to gate destructive/sensitive
// actions like voiding a transaction. Throws a uniform "Incorrect password"
// on any failure so callers don't need to distinguish wrong-password from
// other auth errors.
export async function verifyStaffPassword(email: string | undefined, password: string): Promise<void> {
  if (!email) {
    throw new Error('No signed-in account to verify against')
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    throw new Error('Incorrect password')
  }
}
