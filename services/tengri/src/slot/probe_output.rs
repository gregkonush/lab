#[derive(Default)]
pub(super) struct ProbeOutput(Vec<u8>);

impl ProbeOutput {
    pub(super) fn append(&mut self, data: &[u8]) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.0.len() + data.len() <= 1 << 20,
            "probe output exceeded its limit"
        );
        self.0.extend_from_slice(data);
        Ok(())
    }

    pub(super) fn take_marker(&mut self, marker: &[u8]) -> bool {
        let Some(offset) = self
            .0
            .windows(marker.len())
            .position(|window| window == marker)
        else {
            return false;
        };
        self.0.drain(..offset + marker.len());
        true
    }
}

#[test]
fn markers_received_during_heartbeats_remain_available() {
    let mut output = ProbeOutput::default();
    output.append(b"\x1eTENGRI_IO_END_124\x1f").unwrap();
    output.append(b"shell prompt").unwrap();
    assert!(output.take_marker(b"\x1eTENGRI_IO_END_124\x1f"));
    assert!(!output.take_marker(b"\x1eTENGRI_IO_END_124\x1f"));
}

#[test]
fn split_and_coalesced_markers_keep_the_remaining_output() {
    let mut output = ProbeOutput::default();
    output.append(b"prompt\x1eFIRST").unwrap();
    assert!(!output.take_marker(b"\x1eFIRST\x1f"));
    output.append(b"\x1f\x1eSECOND\x1f").unwrap();
    assert!(output.take_marker(b"\x1eFIRST\x1f"));
    assert!(output.take_marker(b"\x1eSECOND\x1f"));
}

#[test]
fn accumulated_probe_output_keeps_its_byte_bound() {
    let mut output = ProbeOutput::default();
    output.append(&vec![b'x'; 1 << 20]).unwrap();
    assert!(output.append(b"x").is_err());
}
