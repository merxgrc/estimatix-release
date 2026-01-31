'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MapPin, Award, Percent } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { toast } from 'sonner'

interface PricingSetupModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete?: () => void
}

const REGIONS = [
  { value: '0.85', label: 'Rural / Low Cost' },
  { value: '0.95', label: 'Suburban' },
  { value: '1.0', label: 'Metro / Standard' },
  { value: '1.1', label: 'High Cost Metro' },
  { value: '1.2', label: 'Premium Market' }
]

const QUALITY_TIERS = [
  { value: 'budget', label: 'Budget' },
  { value: 'standard', label: 'Standard' },
  { value: 'premium', label: 'Premium' }
]

export function PricingSetupModal({ open, onOpenChange, onComplete }: PricingSetupModalProps) {
  const { user } = useAuth()
  const [regionFactor, setRegionFactor] = useState('1.0')
  const [qualityTier, setQualityTier] = useState('standard')
  const [defaultMargin, setDefaultMargin] = useState('30')
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    if (!user?.id) {
      toast.error('Please sign in to continue')
      return
    }

    setIsSaving(true)
    try {
      // Update or create profile with region_factor and quality_tier
      // First, check if profile exists
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle()

      if (existingProfile) {
        // Update existing profile
        const { error: profileError } = await supabase
          .from('profiles')
          .update({
            region_factor: parseFloat(regionFactor),
            quality_tier: qualityTier
          })
          .eq('id', user.id)

        if (profileError) {
          console.error('Error updating profile:', {
            code: profileError.code,
            message: profileError.message,
            details: profileError.details,
            hint: profileError.hint
          })
          toast.error(`Failed to save region and quality settings: ${profileError.message || 'Unknown error'}`)
          setIsSaving(false)
          return
        }
      } else {
        // Create new profile if it doesn't exist
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            region_factor: parseFloat(regionFactor),
            quality_tier: qualityTier
          })

        if (profileError) {
          console.error('Error creating profile:', {
            code: profileError.code,
            message: profileError.message,
            details: profileError.details,
            hint: profileError.hint
          })
          toast.error(`Failed to create profile: ${profileError.message || 'Unknown error'}`)
          setIsSaving(false)
          return
        }
      }

      // Set default margin rule
      // Try upsert first, if it fails due to constraint issues, try insert then update
      let marginError: any = null
      let marginData: any = null

      try {
        const result = await supabase
          .from('user_margin_rules')
          .upsert({
            user_id: user.id,
            scope: 'all',
            margin_percent: parseFloat(defaultMargin)
          }, {
            onConflict: 'user_id,scope'
          })
          .select()

        marginError = result.error
        marginData = result.data

        // If upsert fails, try insert then update as fallback
        if (marginError) {
          console.warn('[Onboarding] Upsert failed, trying insert/update fallback:', marginError)
          
          // Try to insert first
          const insertResult = await supabase
            .from('user_margin_rules')
            .insert({
              user_id: user.id,
              scope: 'all',
              margin_percent: parseFloat(defaultMargin)
            })
            .select()

          if (insertResult.error) {
            // If insert fails (likely due to conflict), try update
            if (insertResult.error.code === '23505') { // Unique violation
              const updateResult = await supabase
                .from('user_margin_rules')
                .update({
                  margin_percent: parseFloat(defaultMargin)
                })
                .eq('user_id', user.id)
                .eq('scope', 'all')
                .select()

              marginError = updateResult.error
              marginData = updateResult.data
            } else {
              marginError = insertResult.error
            }
          } else {
            marginError = null
            marginData = insertResult.data
          }
        }
      } catch (err) {
        console.error('[Onboarding] Exception in margin rule save:', err)
        marginError = err
      }

      if (marginError) {
        // Log the full error object and its properties
        const errorDetails: any = {
          errorExists: !!marginError,
          errorType: typeof marginError,
        }
        
        if (marginError) {
          try {
            errorDetails.errorKeys = Object.keys(marginError)
            errorDetails.code = marginError.code
            errorDetails.message = marginError.message
            errorDetails.details = marginError.details
            errorDetails.hint = marginError.hint
            errorDetails.stringified = JSON.stringify(marginError, Object.getOwnPropertyNames(marginError), 2)
          } catch (serializeErr) {
            errorDetails.serializeError = String(serializeErr)
            errorDetails.errorString = String(marginError)
          }
        }
        
        console.error('Error setting margin rule:', errorDetails)
        
        const errorMessage = marginError?.message || marginError?.code || String(marginError) || 'Unknown error'
        toast.error(`Failed to save margin setting: ${errorMessage}`)
        setIsSaving(false)
        return
      }

      // Log success for debugging
      if (marginData) {
        console.log('[Onboarding] Margin rule saved successfully:', marginData)
      }

      toast.success('Pricing preferences saved!')
      onOpenChange(false)
      if (onComplete) {
        onComplete()
      }
    } catch (error) {
      console.error('Error saving pricing setup:', error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : String(error))
      toast.error(`Failed to save settings: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Welcome! Let's Set Up Your Pricing</DialogTitle>
          <DialogDescription>
            Help us personalize your estimates by telling us about your business.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Region */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg">Where do you work?</CardTitle>
              </div>
              <CardDescription>
                This adjusts pricing based on your local market conditions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select value={regionFactor} onValueChange={setRegionFactor}>
                <SelectTrigger>
                  <SelectValue placeholder="Select your region" />
                </SelectTrigger>
                <SelectContent>
                  {REGIONS.map(region => (
                    <SelectItem key={region.value} value={region.value}>
                      {region.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Quality Tier */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Award className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg">What is your finish quality?</CardTitle>
              </div>
              <CardDescription>
                This affects the base pricing for materials and labor.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select value={qualityTier} onValueChange={setQualityTier}>
                <SelectTrigger>
                  <SelectValue placeholder="Select quality tier" />
                </SelectTrigger>
                <SelectContent>
                  {QUALITY_TIERS.map(tier => (
                    <SelectItem key={tier.value} value={tier.value}>
                      {tier.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Default Margin */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Percent className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg">Default Margin</CardTitle>
              </div>
              <CardDescription>
                Your standard markup percentage for estimates (you can adjust per trade later).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={defaultMargin}
                  onChange={(e) => setDefaultMargin(e.target.value)}
                  min="0"
                  max="100"
                  className="w-24"
                />
                <span className="text-muted-foreground">%</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Skip for Now
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Saving...
              </>
            ) : (
              'Save & Continue'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

