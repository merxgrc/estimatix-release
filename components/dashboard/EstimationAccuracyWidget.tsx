'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { getEstimationAccuracy } from '@/actions/dashboard'
import { cn } from '@/lib/utils'

interface AccuracyData {
  project_id: string
  project_title: string
  estimated_total: number
  actual_total: number
  variance_percent: number
  created_at: string
}

export function EstimationAccuracyWidget() {
  const [data, setData] = useState<AccuracyData[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const result = await getEstimationAccuracy()
      if (result.success && result.data) {
        setData(result.data)
      }
    } catch (error) {
      console.error('Error loading estimation accuracy:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Estimation Accuracy</CardTitle>
          <CardDescription>Comparing estimated vs actual costs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center text-muted-foreground">
            Loading...
          </div>
        </CardContent>
      </Card>
    )
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Estimation Accuracy</CardTitle>
          <CardDescription>Comparing estimated vs actual costs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center text-muted-foreground">
            <p className="text-sm">Complete at least one job to see accuracy metrics</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Format data for chart
  const chartData = data.map(item => ({
    name: item.project_title.length > 15 
      ? item.project_title.substring(0, 15) + '...' 
      : item.project_title,
    estimated: Math.round(item.estimated_total),
    actual: Math.round(item.actual_total),
    variance: item.variance_percent
  }))

  // Calculate average variance
  const avgVariance = data.reduce((sum, item) => sum + item.variance_percent, 0) / data.length

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Estimation Accuracy</CardTitle>
            <CardDescription>Estimated vs Actual (Last {data.length} completed jobs)</CardDescription>
          </div>
          <div className={cn(
            "flex items-center gap-1 text-sm font-medium",
            avgVariance > 0 ? "text-red-600" : "text-green-600"
          )}>
            {avgVariance > 0 ? (
              <TrendingUp className="h-4 w-4" />
            ) : (
              <TrendingDown className="h-4 w-4" />
            )}
            {avgVariance > 0 ? '+' : ''}{avgVariance.toFixed(1)}% avg variance
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="name" 
              angle={-45}
              textAnchor="end"
              height={80}
              tick={{ fontSize: 12 }}
            />
            <YAxis 
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => `$${value.toLocaleString()}`}
            />
            <RechartsTooltip
              formatter={(value: number) => `$${value.toLocaleString()}`}
              labelStyle={{ fontSize: 12 }}
            />
            <Bar dataKey="estimated" fill="#3b82f6" name="Estimated" radius={[4, 4, 0, 0]} />
            <Bar dataKey="actual" fill="#10b981" name="Actual" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-4 flex items-center justify-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded bg-primary" />
            <span>Estimated</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded bg-green-500" />
            <span>Actual</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}


