type OverlayBackdropProps = {
  fixed?: boolean
} & React.HTMLAttributes<HTMLDivElement>

export function OverlayBackdrop({ fixed, ...props }: OverlayBackdropProps) {
  return (
    <div
      data-blazefire-dialog-backdrop
      data-blazefire-dialog-backdrop-fixed={fixed ? true : undefined}
      {...props}
    />
  )
}
