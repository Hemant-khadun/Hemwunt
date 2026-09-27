import { FOOTER_HDRI_URL } from '../utils/sceneAssets'
import * as THREE from 'three'
import React, { Suspense, useEffect, useState, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { PerspectiveCamera, Environment, MeshDistortMaterial, ContactShadows, MeshTransmissionMaterial } from '@react-three/drei'
import { useSpring } from '@react-spring/core'
import { a } from '@react-spring/three'

// React-spring animates native elements, in this case <mesh/> etc,
// but it can also handle 3rd–party objs, just wrap them in "a".
const AnimatedMaterial = a(MeshDistortMaterial)

export default function Scene({ setBg }) {
  const sphere = useRef()
  const light = useRef()
  const [mode, setMode] = useState(false)
  const [down, setDown] = useState(false)
  const [hovered, setHovered] = useState(false)

  // Change cursor on hovered state
  // useEffect(() => {
  //   document.body.style.cursor = hovered
  //     ? 'none'
  //     : `url('data:image/svg+xml;base64,${btoa(
  //       `<svg xmlns="http://www.w3.org/2000/svg" width="32px" height="32px" viewBox="0 0 24 24" fill="none">
  //         <path fill-rule="evenodd" clip-rule="evenodd" d="M13.4049 17.3737C12.1169 20.1754 7.94756 19.4443 7.6896 16.3716L7.10914 9.45749C6.89678 6.92797 9.72627 5.29437 11.8107 6.74304L17.5083 10.7028C20.0404 12.4626 18.5888 16.4388 15.5185 16.1534L14.7348 16.0805C14.3122 16.0412 13.9109 16.273 13.7336 16.6585L13.4049 17.3737Z" fill="${hovered ? 'white' : '#5089ff'}"/>
  //       </svg>`
  //       )}'), auto`
  // }, [hovered])
  useEffect(() => {
    const cursorSpans = document.querySelectorAll('.Cursor span');
    cursorSpans.forEach(span => {
      span.style.backgroundColor = hovered ? 'transparent' : 'rgb(0, 195, 255)';
    });
  }, [hovered])

  // Make the bubble float and follow the mouse
  // This is frame-based animation, useFrame subscribes the component to the render-loop
  useFrame((state) => {
    light.current.position.x = state.mouse.x * 20
    light.current.position.y = state.mouse.y * 20
    if (sphere.current) {
      sphere.current.position.x = THREE.MathUtils.lerp(sphere.current.position.x, hovered ? state.mouse.x / 2 : 0, 0.2)
      sphere.current.position.y = THREE.MathUtils.lerp(
        sphere.current.position.y,
        Math.sin(state.clock.elapsedTime / 1.5) / 6 + (hovered ? state.mouse.y / 2 : 0),
        0.2
      )
    }
  })

  // Springs for color and overall looks, this is state-driven animation
  // React-spring is physics based and turns static props into animated values
  const [{ wobble, coat, color, ambient, env }] = useSpring(
    {
      wobble: down ? 1.2 : hovered ? 1.05 : 1,
      coat: mode && !hovered ? 0.04 : 1,
      ambient: mode && !hovered ? 1 : 0.5,
      env: mode && !hovered ? 0.3 : 0.5,
      // The sun seen from below the surface — what the ascent rises toward.
      // Pale surface light by default, brightening to specular white on hover,
      // and the mid-water teal in the toggled mode. Was purple, which ended an
      // ocean descent in a colour from a different website.
      color: hovered ? '#dff3fb' : mode ? '#0d4f70' : '#8fd8ff',
      config: (n) => n === 'wobble' && hovered && { mass: 1, tension: 1000, friction: 100 }
    },
    [mode, hovered, down]
  )

  return (
    < > 
      <PerspectiveCamera makeDefault position={[0, 0, 4]} fov={75}>
        <a.ambientLight intensity={ambient} />
        <a.pointLight ref={light} position-z={-15} intensity={env} color="black" />
      </PerspectiveCamera>
      <Suspense fallback={null}>
        <a.mesh
          ref={sphere}
          scale={wobble}
          onPointerOver={() => setHovered(true)}
          onPointerOut={() => setHovered(false)}
          onPointerDown={() => setDown(true)}
          onPointerUp={() => {
            setDown(false)
            setMode(!mode)
            setBg({ background: !mode ? '#000000' : '#000080', fill: !mode ? '#f0f0f0' : '#b1b1fc' })
          }}>
          <sphereGeometry  />
          <AnimatedMaterial 
            color={color} 
            envMapIntensity={env} 
            clearcoat={1} 
            clearcoatRoughness={0} 
            metalness={0.1}
            roughness={0}
            distort={0.5}
            speed={2}
            transparent
            opacity={0.9}
          />
        </a.mesh>
        <Environment files={FOOTER_HDRI_URL} />
      
      </Suspense>
    </>
  )
}
