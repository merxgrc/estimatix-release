import { createServerClient } from './supabase/server'
import type { Profile, ProfileInsert } from '@/types/db'

/**
 * Get the current user's profile, creating a default one if it doesn't exist
 */
export async function getCurrentUserProfile(): Promise<Profile | null> {
  const supabase = await createServerClient()
  
  // Get current user
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  
  if (userError || !user) {
    console.error('Error getting user:', userError)
    return null
  }

  // Try to fetch existing profile
  const { data: profile, error: fetchError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // If profile doesn't exist, create a default one
  if (fetchError && fetchError.code === 'PGRST116') {
    const defaultProfile: ProfileInsert = {
      id: user.id,
      full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || null,
      company_name: null,
      phone: null,
      role: null
    }

    const { data: newProfile, error: insertError } = await supabase
      .from('profiles')
      .insert(defaultProfile)
      .select()
      .single()

    if (insertError) {
      console.error('Error creating profile:', insertError)
      return null
    }

    return newProfile
  }

  if (fetchError) {
    console.error('Error fetching profile:', fetchError)
    return null
  }

  return profile
}

/**
 * Get a profile by user ID
 */
export async function getProfileByUserId(userId: string): Promise<Profile | null> {
  const supabase = await createServerClient()
  
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return null // Profile doesn't exist
    }
    console.error('Error fetching profile:', error)
    return null
  }

  return data
}


