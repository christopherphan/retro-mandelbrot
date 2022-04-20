(; Mandelbrot set WASM program
 ; Christopher Phan, cphan@chrisphan.com
 ; github: christopherphan
 ;
 ; MIT License
 ;
 ; Copyright (c) 2022 Christopher Phan
 ;
 ; Permission is hereby granted, free of charge, to any person obtaining a copy
 ; of this software and associated documentation files (the "Software"), to deal
 ; in the Software without restriction, including without limitation the rights
 ; to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 ; copies of the Software, and to permit persons to whom the Software is
 ; furnished to do so, subject to the following conditions:
 ;
 ; The above copyright notice and this permission notice shall be included in all
 ; copies or substantial portions of the Software.
 ;
 ; THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 ; IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 ; FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 ; AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 ; LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 ; OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 ; SOFTWARE.
 ;)
(module

    ;; Import JavaScript functions to manipulate the screen.

    ;; setinside will toggle the pixel at row, col to be inside the M-set
    (func $set_inside
          (import "imports" "setinside")
          (param i32) ;; row (imaginary component)
          (param i32) ;; col (real component)
    )

    ;; setoutside will toggle the pixel at row, col to be oustide the M-set
    (func $set_outside
          (import "imports" "setoutside")
          (param i32) ;; row (imaginary component)
          (param i32) ;; col (real component)
          (param i32) ;; number of iterations left
                      ;; (lower is more likely to be in the set)
    )

    (func $complex_add
        ;; Add two complex numbers
        ;; Complex numbers are reprsented by pairs of 64-bit floats
        ;; (Real and imaginary components)
        (param $lreal f64) ;; Real component of the left term
        (param $limag f64) ;; Imaginary component of the left term
        (param $rreal f64) ;; Real component of the right term
        (param $rimag f64) ;; Imaginary compnent of the right term
        (result f64 f64)
        ;; Return $lreal + $rreal, $limag + $rimag
        local.get $lreal
        local.get $rreal
        f64.add
        local.get $limag
        local.get $rimag
        f64.add
    )

    (func $complex_mod_sq
        ;; Compute the square of the modulus of a complex number
        ;; i.e. return $real ** 2 + $imag ** 2
        (param $real f64)
        (param $imag f64)
        (result f64)
        local.get $real
        local.get $real
        f64.mul
        local.get $imag
        local.get $imag
        f64.mul
        f64.add
    )

    (func $complex_sq
        ;; Compute the square of a complex number
        ;; i.e. return $real * real - $imag * $imag, 2 * $real * $imag
        (param $real f64)
        (param $imag f64)
        (result f64 f64)
        local.get $real
        local.get $real
        f64.mul
        local.get $imag
        local.get $imag
        f64.mul
        f64.sub
        local.get $real
        local.get $imag
        f64.mul
        f64.const 0x2.
        f64.mul
    )

    (func $mandel_test
        ;; Test if a point c ($creal + $cimag * i) is in the Mandelbrot set
        ;; returning the number of iterations *remaining*
        ;; (i.e. smaller output means more likely in the set.)
        (param $creal f64) ;; real component of c
        (param $cimag f64) ;; imaginary component of c
        (param $bailout f64) ;; bailout (if |z[k]| ** 2 > $bailout ** 2, then
                             ;; conclude c is not in the m-set)
        (param $num_iter i32) ;; number of iterations to compute before deciding that c
                              ;; is in the set.
        (result i32)
        (local $zreal f64) ;; real component of z (z[0] = 0, z[k] = z[k - 1]**2 + c)
        (local $zimag f64) ;; imag component of z
        (local $iter i32) ;; current iteration
        (local $bail_sq f64) ;; $bailout**2
        ;; Square bailout
        local.get $bailout
        local.get $bailout
        f64.mul
        local.set $bail_sq
        ;; Set z = 0
        f64.const 0
        local.tee $zreal
        local.set $zimag
        ;; Set $iter = 0
        i32.const 0
        local.set $iter
        (loop $main
            ;; You know the song... "Just take a point called z in the complex plane..."

            ;; Compute z[k] = z[k - 1] ** 2 + c)
            local.get $creal
            local.get $cimag
            local.get $zreal
            local.get $zimag
            call $complex_sq
            call $complex_add
            local.set $zimag
            local.tee $zreal
            ;; (1) Test |z[k]| ** 2 < $bailout ** 2
            local.get $zimag
            call $complex_mod_sq
            local.get $bail_sq
            f64.lt
            ;; $iter += 1
            local.get $iter
            i32.const 1
            i32.add
            ;; (2) Test $iter < $num_iter
            local.tee $iter
            local.get $num_iter
            i32.lt_u
            ;; Loop if (1) && (2)
            i32.and
         br_if $main)
         ;; Return $num_iter - $iter (number of iterations *left*)
         local.get $num_iter
         local.get $iter
         i32.sub
    )

    (func
        ;; Render the Mandelbrot set
        (export "mandel")

        ;; Screen dimensions
        (param $num_rows i32)
          (param $num_cols i32)

        ;; Upper-left corner of viewing window
        (param $ul_real f64)
        (param $ul_imag f64)

        ;; Lower-right corner of viewing window
        (param $lr_real f64)
        (param $lr_imag f64)

        (param $bailout f64) ;; bailout (if |z[k]| ** 2 > $bailout ** 2, then
                             ;; conclude c is not in the m-set)
        (param $num_iter i32) ;; number of iterations to compute before deciding that c
                              ;; is in the set.
        (local $delta_real f64) ;; Width of a pixel
        (local $delta_imag f64) ;; Height of a pixel

        ;; For iterating in loops
        (local $iter_row i32)
        (local $iter_col i32)

        ;; The current value being tested
        (local $cur_real f64)
        (local $cur_imag f64)

        ;; A place to store our test results
        (local $test_result i32)

        ;; Compute $delta_real = ($lr_real - $ul_real) / $num_cols
        local.get $lr_real
        local.get $ul_real
        f64.sub
        local.get $num_cols
        f64.convert_i32_u
        f64.div
        local.set $delta_real

        ;; compute $delta_imag = ($lr_imag - $ul_imag) / $num_cols
        ;; (Will be negative because highest imag are at the top of the screen
        ;;  and hence lower row numbers.)
        local.get $lr_imag
        local.get $ul_imag
        f64.sub
        local.get $num_rows
        f64.convert_i32_u
        f64.div
        local.set $delta_imag

        ;; Row loop
        i32.const 0
        local.set $iter_row
        (loop $row_loop
            ;; Calculate the imaginary value for the row
            ;; and store it:
            ;; $cur_imag = $ul_imag + $iter_row * $delta_imag
            ;; where $ul_imag is the imaginary component of the
            ;; upper-left corner of the viewing window.
            ;; (Remember, $delta_imag < 0.)

            local.get $ul_imag
            local.get $iter_row
            f64.convert_i32_u
            local.get $delta_imag
            f64.mul
            f64.add
            local.set $cur_imag

            ;; Column loop
            i32.const 0
            local.set $iter_col
            (loop $col_loop
                ;; Calculate the real value for the column
                ;; and store it:
                ;; $cur_real = $ul_real + $iter_col * $delta_real
                ;; where $ul_real is the real component of the 
                ;; upper-left corner of the viewing window.
                local.get $ul_real
                local.get $iter_col
                f64.convert_i32_u
                local.get $delta_real
                f64.mul
                f64.add
                local.tee $cur_real
                ;; Now call $mandel_test on the complex number
                ;; associated with the pixel
                local.get $cur_imag
                local.get $bailout
                local.get $num_iter
                call $mandel_test
                ;; The result (saved as $test_result) is the number 
                ;; of iterations remaining when bailed out. If the
                ;; result is zero, we conclude the point is in the
                ;; Mandelbrot set. 
                local.tee $test_result
                i32.const 0
                i32.eq
                (if $mandel_exec
                     (then
                     ;; If $test_result == 0, then call $set_inside
                     ;; (a JavaScript function) on the pixel coordinates.
                     local.get $iter_row
                     local.get $iter_col
                     call $set_inside
                     )
                     (else
                     ;; Otherwise, call $set_outside on the pixel
                     ;; cordinates and 360 % $test_result, which 
                     ;; specifies the color of the pixel. The color
                     ;; is hsl($test_result % 360, 0.5, 0.5).
                     local.get $iter_row
                     local.get $iter_col
                     local.get $test_result
                     i32.const 360
                     i32.rem_u
                     call $set_outside
                     )
                )
                ;; $iter_col += 1
                local.get $iter_col
                i32.const 1
                i32.add
                local.tee $iter_col
                ;; Loop if $iter_col < $num_cols
                local.get $num_cols
                i32.lt_u
                br_if $col_loop
            )
            ;; $iter_row += 1
            local.get $iter_row
            i32.const 1
            i32.add
            local.tee $iter_row
            ;; Loop if $iter_row < $num_rows
            local.get $num_rows
            i32.lt_u
            br_if $row_loop
       )
    )
)


