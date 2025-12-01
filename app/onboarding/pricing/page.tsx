'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { AuthGuard } from '@/components/auth-guard'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase/client'
import { toast } from 'sonner'

const REGIONS = [
  'Seattle',
  'Bay Area',
  'Los Angeles',
  'San Diego',
  'Portland',
  'Phoenix',
  'Denver',
  'Dallas',
  'Chicago',
  'Miami',
  'National'
]

const QUALITY_OPTIONS = [
  'Budget',
  'Standard',
  'Premium'
]

const TRADE_OPTIONS = [
  'Kitchen',
  'Bath',
  'Cabinets',
  'Drywall',
  'Flooring',
  'Paint',
  'Framing',
  'Electrical',
  'Plumbing',
  'HVAC',
  'Exterior',
  'Windows',
  'Doors',
  'Carpentry'
]

interface UserProfileSettings {
  region: string | null
  quality: string | null
  default_margin: number | null
  main_trades: string[] | null
}

export default function PricingOnboardingPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  
  const [region, setRegion] = useState<string>('')
  const [quality, setQuality] = useState<string>('')
  const [defaultMargin, setDefaultMargin] = useState<number>(20)
  const [selectedTrades, setSelectedTrades] = useState<string[]>([])
  
  const [originalSettings, setOriginalSettings] = useState<UserProfileSettings | null>(null)
  const [hasChanges, setHasChanges] = useState(false)

  // Load existing settings
  useEffect(() => {
    const loadSettings = async () => {
      if (!user?.id) {
        setIsLoading(false)
        return
      }

      try {
        const { data, error } = await supabase
          .from('user_profile_settings')
          .select('*')
          .eq('user_id', user.id)
          .single()

        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
          console.error('Error loading settings:', error)
        }

        if (data) {
          setRegion(data.region || '')
          setQuality(data.quality || '')
          setDefaultMargin(data.default_margin || 20)
          setSelectedTrades(data.main_trades || [])
          
          setOriginalSettings({
            region: data.region,
            quality: data.quality,
            default_margin: data.default_margin,
            main_trades: data.main_trades
          })
        }
      } catch (err) {
        console.error('Error loading user settings:', err)
      } finally {
        setIsLoading(false)
      }
    }

    loadSettings()
  }, [user])

  // Check for changes
  useEffect(() => {
    if (!originalSettings) {
      // If no original settings, enable save if any field is filled
      const hasAnyValue = region || quality || defaultMargin !== 20 || selectedTrades.length > 0
      setHasChanges(hasAnyValue)
      return
    }

    const currentSettings: UserProfileSettings = {
      region: region || null,
      quality: quality || null,
      default_margin: defaultMargin,
      main_trades: selectedTrades.length > 0 ? selectedTrades : null
    }

    const changed = 
      originalSettings.region !== currentSettings.region ||
      originalSettings.quality !== currentSettings.quality ||
      Math.abs((originalSettings.default_margin || 20) - currentSettings.default_margin) > 0.01 ||
      JSON.stringify((originalSettings.main_trades || []).sort()) !== JSON.stringify((currentSettings.main_trades || []).sort())

    setHasChanges(changed)
  }, [region, quality, defaultMargin, selectedTrades, originalSettings])

  const handleTradeToggle = (trade: string) => {
    setSelectedTrades(prev => {
      if (prev.includes(trade)) {
        return prev.filter(t => t !== trade)
      } else {
        return [...prev, trade]
      }
    })
  }

  const handleSave = async () => {
    if (!user?.id) {
      toast.error('You must be logged in to save settings')
      return
    }

    setIsSaving(true)
    try {
      // Save to user_profile_settings
      const { error: settingsError } = await supabase
        .from('user_profile_settings')
        .upsert({
          user_id: user.id,
          region: region || null,
          quality: quality || null,
          default_margin: defaultMargin,
          main_trades: selectedTrades.length > 0 ? selectedTrades : null
        }, {
          onConflict: 'user_id'
        })

      if (settingsError) {
        throw new Error(`Failed to save settings: ${settingsError.message}`)
      }

      // Update user_margin_rules with default margin rule
      const minMargin = Math.round(defaultMargin * 0.75 * 100) / 100
      const maxMargin = Math.round(defaultMargin * 1.25 * 100) / 100

      // First, check if default rule exists
      const { data: existingRules, error: checkError } = await supabase
        .from('user_margin_rules')
        .select('id')
        .eq('user_id', user.id)
        .eq('rule_name', 'Default')
        .maybeSingle()

      if (checkError && checkError.code !== 'PGRST116') {
        console.error('Error checking for existing margin rule:', checkError)
      }

      if (existingRules && existingRules.id) {
        // Update existing rule
        const { error: updateError } = await supabase
          .from('user_margin_rules')
          .update({
            default_margin: defaultMargin,
            min_margin: minMargin,
            max_margin: maxMargin,
            applies_to_cost_codes: null
          })
          .eq('id', existingRules.id)

        if (updateError) {
          console.error('Error updating margin rule:', updateError)
          // Don't throw - settings saved successfully
        }
      } else {
        // Create new rule
        const { error: insertError } = await supabase
          .from('user_margin_rules')
          .insert({
            user_id: user.id,
            rule_name: 'Default',
            default_margin: defaultMargin,
            min_margin: minMargin,
            max_margin: maxMargin,
            applies_to_cost_codes: null
          })

        if (insertError) {
          console.error('Error creating margin rule:', insertError)
          // Don't throw - settings saved successfully
        }
      }

      // Update original settings to reflect saved state
      setOriginalSettings({
        region: region || null,
        quality: quality || null,
        default_margin: defaultMargin,
        main_trades: selectedTrades.length > 0 ? selectedTrades : null
      })

      toast.success('Settings saved successfully!')
    } catch (error) {
      console.error('Error saving settings:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <AuthGuard>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            <p className="text-muted-foreground">Loading settings...</p>
          </div>
        </div>
      </AuthGuard>
    )
  }

  return (
    <AuthGuard>
      <div className="flex min-h-screen items-center justify-center bg-muted/50 p-4">
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle className="text-2xl">Pricing Setup</CardTitle>
            <CardDescription>
              Configure your default pricing preferences to get started with automated estimating.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Primary Region */}
            <div className="space-y-2">
              <Label htmlFor="region">Primary Region</Label>
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger id="region" className="w-full">
                  <SelectValue placeholder="Select your primary region" />
                </SelectTrigger>
                <SelectContent>
                  {REGIONS.map(r => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Typical Quality */}
            <div className="space-y-2">
              <Label htmlFor="quality">Typical Quality</Label>
              <Select value={quality} onValueChange={setQuality}>
                <SelectTrigger id="quality" className="w-full">
                  <SelectValue placeholder="Select typical quality level" />
                </SelectTrigger>
                <SelectContent>
                  {QUALITY_OPTIONS.map(q => (
                    <SelectItem key={q} value={q}>{q}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Default Margin */}
            <div className="space-y-2">
              <Label htmlFor="margin">Default Margin</Label>
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    id="margin"
                    min={0}
                    max={60}
                    value={defaultMargin}
                    onChange={(e) => setDefaultMargin(Number(e.target.value))}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={defaultMargin}
                    min={0}
                    max={60}
                    onChange={(e) => setDefaultMargin(Math.min(60, Math.max(0, Number(e.target.value) || 0)))}
                    className="w-20"
                  />
                  <span className="text-muted-foreground">%</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Your default margin will be used for estimates when no specific rule applies.
                </p>
              </div>
            </div>

            {/* Main Trades */}
            <div className="space-y-2">
              <Label>Main Trades</Label>
              <p className="text-sm text-muted-foreground mb-3">
                Select the trades you typically work with:
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-4 border rounded-lg">
                {TRADE_OPTIONS.map(trade => (
                  <div key={trade} className="flex items-center space-x-2">
                    <Checkbox
                      id={`trade-${trade}`}
                      checked={selectedTrades.includes(trade)}
                      onCheckedChange={() => handleTradeToggle(trade)}
                    />
                    <label
                      htmlFor={`trade-${trade}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      {trade}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end gap-4 pt-4">
              <Button
                variant="outline"
                onClick={() => router.push('/dashboard')}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={!hasChanges || isSaving}
              >
                {isSaving ? (
                  <>
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Saving...
                  </>
                ) : (
                  'Save Settings'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AuthGuard>
  )
}

